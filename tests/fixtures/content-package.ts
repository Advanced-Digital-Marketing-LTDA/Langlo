import type { ContentPackage } from '../../src/lib/server/content-import';
import type { Client } from '@libsql/client';

// Recorded by the pre-0007 package hashing contract; independent of today's importer.
const legacyPackageFingerprint =
  'ce74c388095c5d815f47791d8dd31b43a6d4a5352541136f2a7fef675e190c24';

/** Seed the pre-0007 storage shape without invoking the current importer. */
export async function seedLegacyPackage(client: Client) {
  const pkg = approvedPackage();
  await client.batch(
    [
      ...pkg.skills.map((skill) => ({
        sql: 'INSERT INTO skills (id, language, level) VALUES (?, ?, ?)',
        args: [skill.id, skill.language, skill.level]
      })),
      ...pkg.skills.flatMap((skill) =>
        skill.prerequisites.map((id) => ({
          sql: 'INSERT INTO prerequisites (skill_id, prerequisite_id, language) VALUES (?, ?, ?)',
          args: [skill.id, id, skill.language]
        }))
      ),
      ...pkg.versions.map((version) => ({
        sql: "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES (?, ?, 'fr', ?, 'schema-validated')",
        args: [version.id, version.skillId, version.version]
      })),
      ...pkg.versions.flatMap((version) =>
        version.questions.map((q) => ({
          sql: "INSERT INTO questions (id, content_version_id, skill_id, language, format) VALUES (?, ?, ?, 'fr', ?)",
          args: [q.id, version.id, version.skillId, q.format]
        }))
      ),
      {
        sql: 'INSERT INTO curriculum_imports (curriculum_version, fingerprint) VALUES (?, ?)',
        args: [pkg.curriculumVersion, legacyPackageFingerprint]
      }
    ],
    'write'
  );
  return pkg;
}

// Synthetic, approved French A1 package. It is not checked curriculum: it only
// exercises the importer's gates against the current migration.
export function approvedPackage(): ContentPackage {
  return {
    curriculumVersion: '0.1.0',
    publicationStatus: 'approved',
    dependencySemantics: 'recommended_teaching_order',
    skills: [
      {
        id: 'fr-a1-001',
        language: 'fr',
        level: 'A1',
        review: 'approved',
        prerequisites: []
      },
      {
        id: 'fr-a1-002',
        language: 'fr',
        level: 'A1',
        review: 'approved',
        prerequisites: ['fr-a1-001']
      },
      {
        id: 'fr-a1-003',
        language: 'fr',
        level: 'A1',
        review: 'approved',
        prerequisites: ['fr-a1-001', 'fr-a1-002']
      }
    ],
    versions: [
      {
        id: 'fr-a1-001@1',
        skillId: 'fr-a1-001',
        version: 1,
        review: 'approved',
        questions: [
          {
            id: 'fr-a1-001@1:q1',
            format: 'multiple-choice',
            prompt: 'Je ___ étudiant.',
            answer: 'suis',
            alternatives: ['suis', 'es', 'est']
          },
          {
            id: 'fr-a1-001@1:q2',
            format: 'typed-blank',
            prompt: 'Tu ___ ici.',
            answer: 'es'
          }
        ]
      },
      {
        id: 'fr-a1-002@1',
        skillId: 'fr-a1-002',
        version: 1,
        review: 'approved',
        questions: [
          {
            id: 'fr-a1-002@1:q1',
            format: 'translation',
            prompt: 'We are here.',
            answer: 'Nous sommes ici.',
            alternatives: ['On est ici.']
          }
        ]
      }
    ]
  };
}
