// Error raised by the owner-scoped study repository; `code` selects the
// answer a learner sees (see learner-api.ts).
export class StudyError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
