# WhatTheShell Demo
# Usage: vhs demo.vhs

Output demo.gif

Set FontSize 16
Set FontFamily "Cascadia Code"
Set Shell bash
Set Width 800
Set Height 450
Set Padding 16

# ============ Page 1: wts generate ============
Type "clear"
Enter
Sleep 500ms

Type "wts g find files modified in the last week"
Enter
Sleep 2s

Type "find . -type f -mtime -7 | head -20"
Sleep 1s

Down
Enter
Sleep 1s

# ============ Page 2: wts explain ============
Type "clear"
Enter
Sleep 500ms

Type "wts e git rebase interactive"
Enter
Sleep 2s

Type "# interactive rebase"
Sleep 200ms
Down
Sleep 200ms
Type "# modify last few commits"
Sleep 200ms
Down
Sleep 200ms
Type "# reorder squash edit"
Sleep 200ms
Down
Sleep 200ms
Type "# clean up commit history"
Sleep 1s

# ============ Page 3: wts scaffold ============
Type "clear"
Enter
Sleep 500ms

Type "wts scaffold add gitignore for node"
Enter
Sleep 2s

Type "node_modules/"
Sleep 200ms
Down
Sleep 200ms
Type ".env"
Sleep 200ms
Down
Sleep 200ms
Type "dist/"
Sleep 200ms
Down
Sleep 200ms
Type ".vscode/"
Sleep 200ms
Down
Sleep 200ms
Type "*.log"
Sleep 1s

Down
Sleep 200ms
Down
Sleep 200ms
Enter
Sleep 500ms

# ============ Page 4: Ctrl+G inline ============
Type "clear"
Enter
Sleep 500ms

Type "git checkout -b"
Left 3
Sleep 500ms

Ctrl+G
Sleep 500ms

Type "create feature branch"
Enter
Sleep 2s

Sleep 500ms
Enter
Sleep 1s
