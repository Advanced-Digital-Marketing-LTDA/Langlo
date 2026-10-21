import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  copyFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A temporary migrations folder holding the journal and SQL up to and including `tag`; the caller removes it. */
export async function prefixThrough(tag: string) {
  const directory = await mkdtemp(join(tmpdir(), 'langlo-merge-prefix-'));
  const journal = JSON.parse(
    await readFile('drizzle/meta/_journal.json', 'utf8')
  );
  const end = journal.entries.findIndex(
    (entry: { tag: string }) => entry.tag === tag
  );
  if (end < 0) throw new Error(`Missing migration ${tag}`);
  journal.entries = journal.entries.slice(0, end + 1);
  await mkdir(join(directory, 'meta'));
  await writeFile(
    join(directory, 'meta/_journal.json'),
    JSON.stringify(journal)
  );
  for (const entry of journal.entries)
    await copyFile(
      `drizzle/${entry.tag}.sql`,
      join(directory, `${entry.tag}.sql`)
    );
  return directory;
}
