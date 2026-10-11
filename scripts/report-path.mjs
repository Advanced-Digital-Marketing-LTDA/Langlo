import { readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';

/**
 * Roots a report file may live under: the working directory, the system
 * temporary directory, and CI temp directories exposed through environment
 * variables. Roots that cannot be resolved are skipped.
 *
 * @returns {string[]} canonicalized absolute roots
 */
function allowedRoots() {
  const roots = [process.cwd(), tmpdir()];
  for (const value of [process.env.RUNNER_TEMP, process.env.TMPDIR]) {
    if (value) {
      roots.push(value);
    }
  }
  const canonical = [];
  for (const root of roots) {
    try {
      canonical.push(realpathSync(root));
    } catch {
      // Unreadable roots are not valid report locations.
    }
  }
  return canonical;
}

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
  const contained = allowedRoots().some((root) => {
    const rel = relative(root, target);
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
    // NOSONAR jssecurity:S8707 — resolveReportPath confines the canonicalized
    // target to approved working/temp roots before this read.
    return readFileSync(target, 'utf8');
  } catch {
    throw new Error('Report file could not be read');
  }
}
