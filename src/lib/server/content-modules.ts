import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundlePackage } from './content-bundle';
import { ContentImportError, type ContentPackage } from './content-import';

// Reads the authored curriculum modules (content/<track>/module-NN.json) and
// adds their lessons to the approved bundle as one importer package. Skills
// come from the bundle, lessons and questions from the modules; the importer
// applies every gate. A module that is not approved stops the build.

export type ModuleFile = {
  module_id: string;
  review_status: string;
  lessons: {
    skill_id: string;
    title: string;
    explanation: string;
    examples: Record<string, string>[];
    references: string[];
    version: {
      id: string;
      version: number;
      questions: ContentPackage['versions'][number]['questions'];
    };
  }[];
};

const modulePath = /^module-\d+\.json$/u;

function readModule(path: string): ModuleFile {
  let module: ModuleFile;
  try {
    module = JSON.parse(readFileSync(path, 'utf8')) as ModuleFile;
  } catch {
    throw new ContentImportError('INVALID_MODULE', `${path} is not valid JSON`);
  }
  if (typeof module?.module_id !== 'string' || !Array.isArray(module.lessons))
    throw new ContentImportError('INVALID_MODULE', `${path} has no lessons`);
  return module;
}

/** Every module file under content/, in a stable order. */
export function loadModules(root: string): ModuleFile[] {
  const content = join(root, 'content');
  const modules = readdirSync(content, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((dir) =>
      readdirSync(join(content, dir.name))
        .filter((name) => modulePath.test(name))
        .map((name) => join(content, dir.name, name))
    )
    .sort()
    .map(readModule);
  if (modules.length === 0)
    throw new ContentImportError('NO_MODULES', 'no module files found');
  return modules;
}

/** The approved bundle plus every module's lessons. */
export function modulesPackage(root: string): ContentPackage {
  const versions: ContentPackage['versions'] = [];
  for (const module of loadModules(root)) {
    if (module.review_status !== 'approved')
      throw new ContentImportError(
        'NOT_APPROVED',
        `module ${module.module_id} review status`
      );
    for (const lesson of module.lessons)
      versions.push({
        id: lesson.version.id,
        skillId: lesson.skill_id,
        version: lesson.version.version,
        review: module.review_status,
        lesson: {
          title: lesson.title,
          explanation: lesson.explanation,
          examples: lesson.examples,
          references: lesson.references
        },
        questions: lesson.version.questions.map((q) => ({
          id: q.id,
          format: q.format,
          prompt: q.prompt,
          answer: q.answer,
          alternatives: q.alternatives,
          holdout: q.holdout
        }))
      });
  }
  return bundlePackage(root, versions);
}
