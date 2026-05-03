import updateNotifier from 'update-notifier';
import chalk from 'chalk';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json');

/**
 * Check for npm updates and display notification if a newer version is available.
 * Uses update-notifier for caching (checks once per day by default).
 * Non-blocking: errors are silently ignored.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    const notifier = updateNotifier({
      pkg,
      updateCheckInterval: 1000 * 60 * 60 * 24, // once per day
    });

    if (notifier.update) {
      const { current, latest } = notifier.update;
      console.log();
      console.log(
        `  ${chalk.cyan('[?]')} A new version of ${pkg.name} is available: ` +
        `${chalk.yellow(current)} → ${chalk.green(latest)}`
      );
      console.log(
        `  ${chalk.gray('Run')} ${chalk.cyan('npm install -g ' + pkg.name)} ${chalk.gray('to update.')}`
      );
      console.log();
    }
  } catch {
    // Silently ignore all errors (network, filesystem, etc.)
  }
}

/**
 * Notify update availability at startup.
 * Call this early in main.ts before program.parse().
 *
 * Skipped in `--inline` mode (the Ctrl+G shell-integration code path): inline
 * stdout is consumed by the host shell's readline as the user's command line,
 * and any extra "A new version is available" lines would be spliced into the
 * partially-typed command. The user has plenty of other entry points (any
 * non-inline `wts <subcmd>` invocation) where the notice can show safely.
 */
export function notifyUpdate(): void {
  if (process.argv.includes('--inline')) return;
  // Fire and forget - don't await
  checkForUpdate();
}
