import type { ContentPackage } from '../../src/lib/server/content-import';

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
