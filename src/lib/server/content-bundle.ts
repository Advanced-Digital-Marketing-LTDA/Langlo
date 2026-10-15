import { createHash } from 'node:crypto';
import {
  headers,
  validateBundle
} from '../../../scripts/curriculum-contract.mjs';
import { ContentImportError, type ContentPackage } from './content-import';

// Reads the curriculum bundle (manifest, coverage CSV, prerequisite graph and
// ID registry) through the contract validator, which checks the manifest
// hashes, catalog, registry and graph, and turns it into an importer package.
// Only active skills are imported: retired rows are ID tombstones. Skills are
// reviewed only when the whole bundle is approved; the importer then applies
// its own gates, so a draft bundle is still refused there.

const languages: Record<string, 'fr' | 'de' | 'en'> = {
  French: 'fr',
  German: 'de',
  English: 'en'
};

// The validator requires exactly these columns, in this order.
const lifecycle = headers.indexOf('lifecycle_status');

function validated(root: string) {
  try {
    return validateBundle(root);
  } catch (error) {
    throw new ContentImportError('INVALID_BUNDLE', (error as Error).message);
  }
}

/** Read and validate the bundle at a repository root, adding optional content versions. */
export function bundlePackage(
  root: string,
  versions: ContentPackage['versions'] = []
): ContentPackage {
  const { manifest, catalog, graph } = validated(root);
  const review =
    manifest.publication_status === 'approved' ? 'approved' : 'unreviewed';
  const edges = new Map(
    graph.nodes.map((node) => [node.skill_id, node.prerequisites])
  );
  const skills = [...catalog.values()]
    .filter((row) => row[lifecycle] === 'active')
    .map(([id, language, level]) => ({
      id,
      language: languages[language],
      level: level as 'A1' | 'A2',
      review,
      prerequisites: edges.get(id) ?? []
    }));
  return {
    curriculumVersion: manifest.curriculum_version,
    publicationStatus: manifest.publication_status,
    dependencySemantics: manifest.dependency_semantics,
    // The manifest's file hashes identify the bundle content; its other
    // fields are fixed by the contract or already in the package.
    bundleDigest: createHash('sha256')
      .update(
        [
          manifest.coverage_sha256,
          manifest.prerequisites_sha256,
          manifest.id_registry_sha256
        ].join('\n')
      )
      .digest('hex'),
    skills,
    versions
  };
}
