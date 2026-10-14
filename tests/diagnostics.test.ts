import { expect, it } from 'vitest';
import { ConfigError } from '../src/lib/server/config';
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
it('reports a validated configuration variable name without its value', () => {
  const diagnostic = safeDiagnostic(
    'configuration',
    new ConfigError('MAIL_TRANSPORT'),
    '12345678-1234-4234-8234-123456789abc'
  );
  expect(diagnostic).toEqual({
    operation: 'configuration',
    kind: 'configuration',
    correlationId: '12345678-1234-4234-8234-123456789abc',
    variable: 'MAIL_TRANSPORT'
  });
  expect(JSON.stringify(diagnostic)).not.toMatch(/capture|smtp|secret/i);
});
it('does not report forged configuration names or secret-bearing names', () => {
  const invalidName = new ConfigError('PROTON_SMTP_TOKEN=synthetic-secret');
  const forged = Object.assign(new ConfigError('APP_ORIGIN'), {
    variable: 'PROTON_SMTP_TOKEN=synthetic-secret'
  });
  expect(String(invalidName)).toBe('ConfigError: Invalid configuration');
  const diagnostic = safeDiagnostic(
    'configuration',
    forged,
    '12345678-1234-4234-8234-123456789abc'
  );
  expect(diagnostic).toEqual({
    operation: 'configuration',
    kind: 'configuration',
    correlationId: '12345678-1234-4234-8234-123456789abc'
  });
  expect(JSON.stringify(diagnostic)).not.toMatch(
    /PROTON|SMTP|synthetic-secret/
  );
  expect(
    safeDiagnostic(
      'configuration',
      invalidName,
      '12345678-1234-4234-8234-123456789abc'
    )
  ).not.toHaveProperty('variable');
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
