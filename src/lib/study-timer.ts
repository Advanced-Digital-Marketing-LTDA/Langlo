export type StudyCategory = 'flashcards' | 'grammar';

export type StudySegment = {
  id: string;
  category: StudyCategory;
  startedAt: number;
  endedAt: number;
};

// More than a minute without an action on the page stops the timer; the idle
// stretch is not counted and the next action starts a new segment.
export const idleLimitMs = 60_000;

/**
 * Active study time for one page load. `activity` marks an action (or the page
 * becoming visible); `stop` ends the running segment when the tab is hidden or
 * the page is left. Each finished segment is passed to `send` once.
 */
export function createStudyTimer(
  category: StudyCategory,
  send: (segment: StudySegment) => void,
  newId: () => string = () => crypto.randomUUID()
) {
  let startedAt: number | null = null;
  let lastAction = 0;

  function finish(endedAt: number) {
    if (startedAt !== null && endedAt > startedAt)
      send({ id: newId(), category, startedAt, endedAt });
    startedAt = null;
  }

  return {
    activity(now: number) {
      if (startedAt !== null && now - lastAction > idleLimitMs)
        finish(lastAction);
      if (startedAt === null) startedAt = now;
      lastAction = now;
    },
    stop(now: number) {
      if (startedAt === null) return;
      finish(now - lastAction > idleLimitMs ? lastAction : now);
    }
  };
}

/** Save a finished segment; keepalive lets the request outlive the page. */
export async function sendStudySegment(segment: StudySegment): Promise<void> {
  const response = await fetch('/app/api/study-time', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(segment),
    keepalive: true
  });
  if (!response.ok)
    throw new Error(`Study time was not saved (${response.status}).`);
}
