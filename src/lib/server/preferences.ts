import type { Client } from '@libsql/client';
import type { LearnerSession } from './learner-session';
import { StudyError } from './study-error';

/** True for an IANA timezone name the runtime knows, e.g. "Europe/Lisbon". */
export function isTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64)
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The caller's saved timezone, or null when none has been chosen. */
export async function getTimezone(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession
): Promise<string | null> {
  const result = await client.execute({
    sql: 'SELECT timezone FROM learner_preferences WHERE owner_id = ?',
    args: [learner.userId]
  });
  return result.rows[0] ? String(result.rows[0].timezone) : null;
}

/** Save the caller's timezone; an unknown name is rejected, never stored. */
export async function setTimezone(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  timezone: unknown
): Promise<void> {
  if (!isTimezone(timezone)) throw new StudyError('INVALID_TIMEZONE');
  await client.execute({
    sql: `INSERT INTO learner_preferences (owner_id, timezone) VALUES (?, ?)
      ON CONFLICT (owner_id) DO UPDATE SET timezone = excluded.timezone, updated_at = unixepoch() * 1000`,
    args: [learner.userId, timezone]
  });
}
