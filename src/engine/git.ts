/**
 * Git helpers — shared commit logic with eforge attribution.
 * All engine-level commits go through forgeCommit() to ensure
 * the "Forged by eforge" attribution is always appended.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const ATTRIBUTION = 'Forged by eforge https://eforge.run';

/**
 * Create a git commit with the eforge attribution appended.
 *
 * @param cwd - Working directory for the git command
 * @param message - Commit message (attribution is appended automatically)
 * @param paths - Optional paths to pass after `--` (for `git commit -m <msg> -- <paths>`)
 */
export async function forgeCommit(cwd: string, message: string, paths?: string[]): Promise<void> {
  const fullMessage = `${message}\n\n${ATTRIBUTION}`;
  const args = ['commit', '-m', fullMessage];
  if (paths && paths.length > 0) {
    args.push('--', ...paths);
  }
  await exec('git', args, { cwd });
}
