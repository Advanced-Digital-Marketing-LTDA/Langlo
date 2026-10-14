import { describe, expect, it } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import {
  learnerSessionFrom,
  requireLearnerApi,
  requireLearnerPage
} from '../src/lib/server/learner-session';

const user = { id: 'learner-a', email: 'a@example.test', name: 'A' };
const session = {
  id: 'session-a',
  userId: 'learner-a',
  expiresAt: new Date(0)
};

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('learner session derivation', () => {
  it('derives the learner only from the verified user', () => {
    expect(learnerSessionFrom({ user, session })).toEqual({
      userId: 'learner-a'
    });
  });

  it('ignores client-shaped learner fields smuggled onto locals', () => {
    const locals = {
      user,
      session,
      learnerId: 'learner-b',
      userId: 'learner-b',
      ownerId: 'learner-b'
    };
    expect(learnerSessionFrom(locals)).toEqual({ userId: 'learner-a' });
  });

  it('returns no learner without a verified user', () => {
    expect(learnerSessionFrom({})).toBeNull();
    expect(learnerSessionFrom({ user: null, session: null })).toBeNull();
    expect(
      learnerSessionFrom({ user: { ...user, id: '  ' }, session })
    ).toBeNull();
  });

  it('rejects a session bound to a different user', () => {
    expect(
      learnerSessionFrom({ user, session: { ...session, userId: 'learner-b' } })
    ).toBeNull();
  });

  it('returns a frozen learner session', () => {
    const learner = learnerSessionFrom({ user, session });
    expect(Object.isFrozen(learner)).toBe(true);
  });
});

describe('private route helpers', () => {
  // Request parameters, query and body naming another learner are never read.
  const forgedRequest = {
    url: new URL('http://localhost/app?userId=learner-b&ownerId=learner-b'),
    params: { learnerId: 'learner-b' },
    request: new Request('http://localhost/app', {
      method: 'POST',
      body: new URLSearchParams({ userId: 'learner-b' })
    })
  };

  it('pages redirect to login when no verified user exists, whatever the request names', () => {
    const error = thrown(() =>
      requireLearnerPage({ ...forgedRequest, locals: {} })
    );
    expect(isRedirect(error)).toBe(true);
    expect(error).toMatchObject({ status: 303, location: '/login' });
  });

  it('actions and endpoints answer 401 when no verified user exists', () => {
    const error = thrown(() =>
      requireLearnerApi({ ...forgedRequest, locals: { user: null } })
    );
    expect(isHttpError(error, 401)).toBe(true);
  });

  it('returns the verified learner, never the request-supplied one', () => {
    for (const require of [requireLearnerPage, requireLearnerApi]) {
      expect(require({ ...forgedRequest, locals: { user, session } })).toEqual({
        userId: 'learner-a'
      });
    }
  });
});
