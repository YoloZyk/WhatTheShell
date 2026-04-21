import { renderInitScript, isSupportedShell, SUPPORTED_SHELLS } from '../integrations/shell';
import { detectShell } from '../core/shell';

/**
 * Prints the integration script for the given shell to stdout.
 * Users pipe it into `eval` to install for the current session;
 * `wts init` appends it to the shell's rc file for permanent use.
 *
 * If stdout is a TTY (user ran the command directly in an interactive
 * shell), we also print a friendly hint to stderr so newcomers don't
 * mistake the script dump for an error.
 */
export function shellInitCommand(shellArg?: string): void {
  const shell = (shellArg || detectShell() || 'bash').toLowerCase();

  if (!isSupportedShell(shell)) {
    process.stderr.write(
      `wts shell-init: unsupported shell "${shell}"\n` +
      `  Supported: ${SUPPORTED_SHELLS.join(', ')}\n`
    );
    process.exitCode = 2;
    return;
  }

  if (process.stdout.isTTY) {
    process.stderr.write(
      `wts shell-init: this prints the integration script to stdout for your shell to eval — it's not meant to be read by you.\n` +
      `\n` +
      renderInstallHint(shell) +
      `\n` +
      `  The script below follows, for the curious:\n` +
      `\n`
    );
  }

  process.stdout.write(renderInitScript(shell));
}

function renderInstallHint(shell: string): string {
  if (shell === 'zsh' || shell === 'bash') {
    return (
      `  Activate in current session:\n` +
      `    eval "$(wts shell-init ${shell})"\n` +
      `\n` +
      `  Install permanently:\n` +
      `    echo 'eval "$(wts shell-init ${shell})"' >> ~/.${shell}rc\n`
    );
  }
  if (shell === 'fish') {
    return (
      `  Activate in current session:\n` +
      `    wts shell-init fish | source\n` +
      `\n` +
      `  Install permanently:\n` +
      `    wts shell-init fish > ~/.config/fish/conf.d/wts.fish\n`
    );
  }
  if (shell === 'powershell') {
    return (
      `  Activate in current session:\n` +
      `    wts shell-init powershell | Out-String | Invoke-Expression\n` +
      `\n` +
      `  Install permanently:\n` +
      `    wts shell-init powershell | Out-String | Add-Content -Path $PROFILE\n` +
      `    # then open a new PowerShell window, or run: . $PROFILE\n`
    );
  }
  return '  Append the eval line to your shell config\n';
}
