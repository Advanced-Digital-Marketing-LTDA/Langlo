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
  requestReservedLibraryAi,
  reserveLibraryAiCall,
  validateLibraryAiInput,
  type LibraryAiInput
} from '../../../../../../lib/server/library-ai';
import { containsTerm } from '../../../../../../lib/library-text';
import {
  openAiKeysFromConfig,
  requireKeys
} from '../../../../../../lib/server/openai-guard';
import { StudyError } from '../../../../../../lib/server/study-error';

const maxSentenceLength = 2000;

function sentenceText(value: unknown, required: boolean): string {
  if (typeof value !== 'string' || value.includes('\0'))
    throw new StudyError('INVALID_LIBRARY_TERM');
  const text = value.trim();
  if (text.length > maxSentenceLength || (required && !text))
    throw new StudyError('INVALID_LIBRARY_TERM');
  return text;
}

export const POST: RequestHandler = (event) =>
  learnerApi(event, async (client, learner) => {
    const body = await readJsonObject(event.request);
    if (body.action !== 'translate' && body.action !== 'lookup')
      throw new StudyError('INVALID_LIBRARY_ACTION');
    const document = await getLibraryDocument(client, learner, event.params.id);
    const sentence = sentenceText(body.sentence, true);
    const previousSentence = sentenceText(body.previousSentence ?? '', false);
    const nextSentence = sentenceText(body.nextSentence ?? '', false);
    const normalizedTerm =
      typeof body.term === 'string' ? body.term.trim() : '';
    if (
      body.action === 'lookup' &&
      (!normalizedTerm ||
        normalizedTerm.length > 256 ||
        !containsTerm(sentence, normalizedTerm))
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
      previousSentence,
      sentence,
      nextSentence,
      ...(body.action === 'lookup' ? { term: normalizedTerm } : {})
    };
    validateLibraryAiInput(input);
    const keys = requireKeys(openAiKeysFromConfig(event.locals.config));
    const reservedAt = Date.now();
    if (!(await reserveLibraryAiCall(client, learner.userId, reservedAt)))
      throw new StudyError('LIBRARY_AI_LIMIT');
    const result = await requestReservedLibraryAi(
      client,
      learner.userId,
      reservedAt,
      keys,
      input
    );
    return typeof result === 'string' ? { result } : result;
  });
