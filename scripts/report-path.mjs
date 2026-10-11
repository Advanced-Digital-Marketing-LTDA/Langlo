import { readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';

/**
 * Resolve a CLI-supplied report path and confirm the canonicalized target
 * stays inside an allowed root: the working directory, the system temporary
 * directory, or a CI temp directory exposed through RUNNER_TEMP/TMPDIR.
 * Anything else is rejected before a read is attempted.
 *
 * @param {string} reportPath
 * @returns {string} canonicalized absolute report path
 */
export function resolveReportPath(reportPath) {
  let target;
  try {
    target = realpathSync(resolve(process.cwd(), reportPath));
  } catch {
    throw new Error('Report file could not be read');
  }
  const roots = [process.cwd(), tmpdir()];
  for (const name of ['RUNNER_TEMP', 'TMPDIR']) {
    const value = process.env[name];
    if (value) {
      roots.push(value);
    }
  }
  const contained = roots.some((root) => {
    let canonicalRoot;
    try {
      canonicalRoot = realpathSync(root);
    } catch {
      return false;
    }
    const rel = relative(canonicalRoot, target);
    return (
      rel !== '' &&
      rel !== '..' &&
      !rel.startsWith(`..${sep}`) &&
      !isAbsolute(rel)
    );
  });
  if (!contained) {
    throw new Error(
      'Report path resolves outside the allowed working or temp directories'
    );
  }
  return target;
}

/**
 * Read a report file after {@link resolveReportPath} containment succeeds.
 * I/O failures surface as a fixed message so filesystem details do not reach
 * CI logs through the CLI error path.
 *
 * @param {string} reportPath
 * @returns {string} file contents
 */
export function readReportFile(reportPath) {
  const target = resolveReportPath(reportPath);
  try {
    return readFileSync(target, 'utf8');
  } catch {
    throw new Error('Report file could not be read');
  }
}
