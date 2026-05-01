import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ShellType, Step, ExecutionResult } from '../types';

export class StepExecutor {
  private shell: ShellType;
  private cwd: string;

  constructor(shell: ShellType, initialCwd?: string) {
    this.shell = shell;
    this.cwd = initialCwd || process.cwd();
  }

  getCwd(): string {
    return this.cwd;
  }

  async executeStep(step: Step): Promise<ExecutionResult> {
    try {
      const result = await this.runScript(step.command);

      // Sentinel-based runtime cwd detection: subprocess writes its final
      // working directory to a temp file at script end; we read it back and
      // update our tracked cwd. Works for any cd / Set-Location / Push-Location
      // pattern, including pipeline forms (`New-Item ... | Set-Location`) and
      // chained commands (`mkdir x; cd x`).
      if (result.cwdAfter && result.cwdAfter.length > 0) {
        this.cwd = result.cwdAfter;
      }

      return {
        step,
        success: result.code === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        cwd: this.cwd,
        error: result.code !== 0 ? `Exit code: ${result.code}` : undefined,
      };
    } catch (err: any) {
      return {
        step,
        success: false,
        stdout: '',
        stderr: '',
        cwd: this.cwd,
        error: err.message || 'Unknown error',
      };
    }
  }

  /** Write the command to a temp script file, append a sentinel write at the
   *  end, spawn the shell against the file. Single-line and multi-line both
   *  go through this path so cwd tracking is uniform. */
  private async runScript(command: string): Promise<{ stdout: string; stderr: string; code: number; cwdAfter?: string }> {
    const ext = this.shell === 'powershell' ? 'ps1' : this.shell === 'fish' ? 'fish' : 'sh';
    const stamp = `${process.pid}-${Date.now()}`;
    const tmpFile = path.join(os.tmpdir(), `wts-step-${stamp}.${ext}`);
    const sentinelFile = path.join(os.tmpdir(), `wts-cwd-${stamp}.txt`);

    const scriptBody = this.buildScriptBody(command, sentinelFile);

    // Write with UTF-8 BOM on PowerShell so PS 5.1 picks the right codepage when reading the file.
    const data = this.shell === 'powershell'
      ? Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(scriptBody, 'utf8')])
      : Buffer.from(scriptBody, 'utf8');

    fs.writeFileSync(tmpFile, data);

    try {
      const exec = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const args = this.getScriptArgs(tmpFile);
        const child = spawn(this.getShellExecutable(), args, {
          cwd: this.cwd,
          env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });

        child.on('close', (code) => resolve({ stdout, stderr, code: code || 0 }));
        child.on('error', (err) => resolve({ stdout, stderr: err.message, code: 1 }));
      });

      let cwdAfter: string | undefined;
      try {
        cwdAfter = fs.readFileSync(sentinelFile, 'utf8').trim();
      } catch {
        // Sentinel may not exist if the script aborted before reaching the tail
        // write (PowerShell with $ErrorActionPreference=Stop, or kill -9).
        // Fall back to existing cwd in that case.
      }

      return { ...exec, cwdAfter };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      try { fs.unlinkSync(sentinelFile); } catch { /* ignore */ }
    }
  }

  /** Build the script body with prologue (encoding) and epilogue (sentinel write). */
  private buildScriptBody(command: string, sentinelFile: string): string {
    if (this.shell === 'powershell') {
      // PS single-quoted strings escape ' as ''. Backslashes are literal.
      const sentinelLit = sentinelFile.replace(/'/g, "''");
      // Why try/finally with codepage restore:
      // [Console]::OutputEncoding's setter calls Win32 SetConsoleOutputCP,
      // which mutates the codepage of the console ATTACHED to this process —
      // and that console is shared with the parent PowerShell (spawn doesn't
      // detach console by default). Without restoring on exit, the parent's
      // PSReadLine keeps rendering future input/history under the assumption
      // of the OLD codepage (GBK on Chinese Windows), so any Chinese chars
      // typed/recalled after wts ran show up as mojibake.
      //
      // Why the Set-Content / Out-File / Add-Content overrides:
      // PS 5.1's `-Encoding utf8` always emits UTF-8 *with BOM* — there is
      // no `utf8NoBOM` option until PS 6+. A BOM-prefixed package.json
      // breaks Node's JSON.parse, and BOMs in shell scripts / makefiles
      // break various tools. We override these cmdlets with same-named
      // functions that write BOM-less UTF-8 via [System.IO.File] APIs.
      const overrides = [
        'function Set-Content {',
        '  [CmdletBinding()] param(',
        '    [Parameter(Mandatory=$true, Position=0)][string]$Path,',
        '    [Parameter(Mandatory=$true, ValueFromPipeline=$true, Position=1)][object]$Value,',
        '    [switch]$NoNewline, [switch]$Force, $Encoding, [switch]$PassThru',
        '  )',
        '  begin { $accum = New-Object System.Collections.Generic.List[string] }',
        '  process { if ($null -ne $Value) { foreach ($v in @($Value)) { $accum.Add([string]$v) } } }',
        '  end {',
        '    $text = $accum -join "`n"',
        '    if (-not $NoNewline -and $accum.Count -gt 0) { $text += "`n" }',
        '    $abs = if ([System.IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path (Get-Location -PSProvider FileSystem).ProviderPath $Path }',
        '    $parent = Split-Path $abs -Parent',
        '    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force -ErrorAction SilentlyContinue | Out-Null }',
        '    [System.IO.File]::WriteAllText($abs, $text, [System.Text.UTF8Encoding]::new($false))',
        '  }',
        '}',
        'function Out-File {',
        '  [CmdletBinding()] param(',
        '    [Parameter(Mandatory=$true, Position=0)][string]$FilePath,',
        '    [Parameter(Mandatory=$true, ValueFromPipeline=$true)][object]$InputObject,',
        '    [switch]$Append, [switch]$NoNewline, [switch]$Force, $Encoding, [int]$Width',
        '  )',
        '  begin { $accum = New-Object System.Collections.Generic.List[string] }',
        '  process { if ($null -ne $InputObject) { foreach ($v in @($InputObject)) { $accum.Add([string]$v) } } }',
        '  end {',
        '    $text = $accum -join "`n"',
        '    if (-not $NoNewline -and $accum.Count -gt 0) { $text += "`n" }',
        '    $abs = if ([System.IO.Path]::IsPathRooted($FilePath)) { $FilePath } else { Join-Path (Get-Location -PSProvider FileSystem).ProviderPath $FilePath }',
        '    $parent = Split-Path $abs -Parent',
        '    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force -ErrorAction SilentlyContinue | Out-Null }',
        '    $enc = [System.Text.UTF8Encoding]::new($false)',
        '    if ($Append) { [System.IO.File]::AppendAllText($abs, $text, $enc) } else { [System.IO.File]::WriteAllText($abs, $text, $enc) }',
        '  }',
        '}',
        'function Add-Content {',
        '  [CmdletBinding()] param(',
        '    [Parameter(Mandatory=$true, Position=0)][string]$Path,',
        '    [Parameter(Mandatory=$true, ValueFromPipeline=$true, Position=1)][object]$Value,',
        '    [switch]$NoNewline, [switch]$Force, $Encoding',
        '  )',
        '  begin { $accum = New-Object System.Collections.Generic.List[string] }',
        '  process { if ($null -ne $Value) { foreach ($v in @($Value)) { $accum.Add([string]$v) } } }',
        '  end {',
        '    $text = $accum -join "`n"',
        '    if (-not $NoNewline -and $accum.Count -gt 0) { $text += "`n" }',
        '    $abs = if ([System.IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path (Get-Location -PSProvider FileSystem).ProviderPath $Path }',
        '    $parent = Split-Path $abs -Parent',
        '    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force -ErrorAction SilentlyContinue | Out-Null }',
        '    [System.IO.File]::AppendAllText($abs, $text, [System.Text.UTF8Encoding]::new($false))',
        '  }',
        '}',
      ].join('\n');
      return [
        '$wtsOrigOutputCP = [Console]::OutputEncoding',
        'try {',
        '$OutputEncoding = [System.Text.Encoding]::UTF8',
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        '$ErrorActionPreference = "Continue"',
        overrides,
        command,
        // ProviderPath always returns the real OS filesystem path, even when
        // Set-Location has been driven through a pipeline (e.g.
        // `New-Item ... | Set-Location`) that leaves $PWD.Path in PSPath form
        // like 'Microsoft.PowerShell.Core\FileSystem::E:\foo'. Spawning a child
        // with PSPath as cwd would ENOENT.
        `[System.IO.File]::WriteAllText('${sentinelLit}', $PWD.ProviderPath)`,
        '} finally {',
        '[Console]::OutputEncoding = $wtsOrigOutputCP',
        '}',
      ].join('\n');
    }

    if (this.shell === 'fish') {
      const sentinelLit = sentinelFile.replace(/'/g, "\\'");
      return `${command}\nprintf '%s' (pwd) > '${sentinelLit}'\n`;
    }

    // bash / zsh
    const sentinelLit = sentinelFile.replace(/'/g, "'\\''");
    // On Windows (git bash / msys / cygwin), $PWD is POSIX-style (e.g.
    // /e/pyku/foo). Node's spawn on Windows treats that as a non-existent
    // cwd and ENOENTs on the next step. cygpath -w converts to a real
    // Windows path; fall back to $PWD if cygpath is unavailable.
    const writeCwd = process.platform === 'win32'
      ? `if command -v cygpath >/dev/null 2>&1; then printf '%s' "$(cygpath -w "$PWD")" > '${sentinelLit}'; else printf '%s' "$PWD" > '${sentinelLit}'; fi`
      : `printf '%s' "$PWD" > '${sentinelLit}'`;
    return `${command}\n${writeCwd}\n`;
  }

  private getScriptArgs(file: string): string[] {
    if (this.shell === 'powershell') {
      return ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file];
    }
    return [file];
  }

  private getShellExecutable(): string {
    if (process.platform === 'win32') {
      const winShellMap: Record<string, string> = {
        'powershell': 'powershell.exe',
        'cmd': 'cmd.exe',
        'bash': 'bash.exe',
        'fish': 'fish.exe',
      };
      return winShellMap[this.shell] || 'powershell.exe';
    }
    const unixShellMap: Record<string, string> = {
      'bash': '/bin/bash',
      'zsh': '/bin/zsh',
      'fish': '/usr/bin/fish',
      'powershell': '/usr/bin/pwsh',
    };
    return unixShellMap[this.shell] || '/bin/sh';
  }
}
