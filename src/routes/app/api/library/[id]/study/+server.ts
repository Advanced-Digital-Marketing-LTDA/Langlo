import type { RequestHandler } from './$types';
import {
  learnerApi,
  readJsonObject
} from '../../../../../../lib/server/learner-api';
import {
  getLibraryDocument,
  libraryTargetLanguage,
  type LibraryLanguage
} from '../../../../../../lib/server/library';
import {
  requestLibraryAi,
  reserveLibraryAiCall,
  validateLibraryAiInput,
  type LibraryAiInput
} from '../../../../../../lib/server/library-ai';
import {
  containsTerm,
  splitSentences
} from '../../../../../../lib/library-text';
import { StudyError } from '../../../../../../lib/server/study-error';

export const POST: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => {
    const body = await readJsonObject(event.request);
    if (body.action !== 'translate' && body.action !== 'lookup')
      throw new StudyError('INVALID_LIBRARY_ACTION');
    const document = await getLibraryDocument(client, learner, event.params.id);
    const sentences = splitSentences(document.content);
    if (
      !Number.isInteger(body.sentenceIndex) ||
      Number(body.sentenceIndex) < 0 ||
      Number(body.sentenceIndex) >= sentences.length
    )
      throw new StudyError('INVALID_LIBRARY_PROGRESS');
    const sentenceIndex = Number(body.sentenceIndex);
    const term = body.term;
    const normalizedTerm = typeof term === 'string' ? term.trim() : '';
    if (
      body.action === 'lookup' &&
      (!normalizedTerm ||
        normalizedTerm.length > 256 ||
        !containsTerm(sentences[sentenceIndex], normalizedTerm))
    )
      throw new StudyError('INVALID_LIBRARY_TERM');
    const targetLanguage = await libraryTargetLanguage(
      client,
      learner,
      document.language
    );
    const input: LibraryAiInput = {
      action: body.action,
      language: document.language as LibraryLanguage,
      targetLanguage,
      previousSentence: sentences[sentenceIndex - 1] ?? '',
      sentence: sentences[sentenceIndex],
      nextSentence: sentences[sentenceIndex + 1] ?? '',
      ...(body.action === 'lookup' ? { term: normalizedTerm } : {})
    };
    validateLibraryAiInput(input);
    const apiKey = event.locals.config?.openAiApiKey;
    if (!apiKey) throw new StudyError('LIBRARY_AI_UNAVAILABLE');
    if (!(await reserveLibraryAiCall(client, learner.userId)))
      throw new StudyError('LIBRARY_AI_LIMIT');
    return {
      result: await requestLibraryAi(apiKey, input)
    };
  });
