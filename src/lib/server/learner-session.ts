import { error, redirect } from '@sveltejs/kit';
import type { LearnerSession } from './flashcards';

export type { LearnerSession };

type VerifiedLocals = Pick<App.Locals, 'user' | 'session'>;

/**
 * Derive the learner only from the user the auth hook verified. Request
 * params, query strings, bodies and any other locals field are never read, so
 * a client-supplied learner, owner or user ID cannot select whose rows load.
 */
export function learnerSessionFrom(
  locals: Partial<VerifiedLocals>
): LearnerSession | null {
  const user = locals.user;
  if (!user || typeof user.id !== 'string' || !user.id.trim()) return null;
  if (locals.session && locals.session.userId !== user.id) return null;
  return Object.freeze({ userId: user.id });
}

/** Page loads: no verified learner redirects to sign in. */
export function requireLearnerPage(event: {
  locals: Partial<VerifiedLocals>;
}): LearnerSession {
  const learner = learnerSessionFrom(event.locals);
  if (!learner) redirect(303, '/login');
  return learner;
}

/** Form actions and endpoints: no verified learner answers 401. */
export function requireLearnerApi(event: {
  locals: Partial<VerifiedLocals>;
}): LearnerSession {
  const learner = learnerSessionFrom(event.locals);
  if (!learner) error(401, 'Sign in required.');
  return learner;
}
