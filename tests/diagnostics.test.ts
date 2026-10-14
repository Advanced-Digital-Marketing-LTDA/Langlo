import { expect, it } from 'vitest';
import { safeDiagnostic, safeError } from '../src/lib/server/diagnostics';

it('projects only safe diagnostic fields from arbitrary errors', () => {
  const thrown = Object.assign(
    new Error('answer=private-answer token=secret'),
    { body: 'private-answer', authorization: 'secret' }
  );
  const diagnostic = safeDiagnostic(
    'request',
    thrown,
    '12345678-1234-4234-8234-123456789abc'
  );
  expect(diagnostic).toEqual({
    operation: 'request',
    kind: 'unexpected',
    correlationId: '12345678-1234-4234-8234-123456789abc'
  });
  expect(JSON.stringify(diagnostic)).not.toMatch(
    /private-answer|secret|stack|body|authorization/
  );
});
it('rejects attacker-controlled correlation identifiers', () => {
  expect(safeError('secret-token\r\nSet-Cookie: x')).toEqual({
    message: 'Something went wrong. Please try again.',
    correlationId: undefined
  });
});
it('returns an actionable safe error without reflecting exception content', () => {
  expect(safeError('12345678-1234-4234-8234-123456789abc').message).toContain(
    'try again'
  );
});
