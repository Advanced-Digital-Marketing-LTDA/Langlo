import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Holdout prompts reworded because the task was unclear, by the earlier
// question's id. The revision carries exactly this prompt and changes nothing
// else about the question; the new wording is pinned word for word in the JSON.
const entries = JSON.parse(
  readFileSync(
    join(process.cwd(), 'tests/fixtures/clarified-prompts.json'),
    'utf8'
  )
) as [string, string][];
export const clarifiedPrompts = new Map<string, string>(entries);
if (clarifiedPrompts.size !== entries.length)
  throw new Error('clarified-prompts.json repeats an earlier question id');
