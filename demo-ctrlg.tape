# Demo: Ctrl+G inline
# Usage: vhs demo-ctrlg.tape

Output demo-ctrlg.gif

Set Shell "bash"
Set FontSize 18
Set FontFamily "Cascadia Code"
Set Width 900
Set Height 500
Set Padding 16
Set TypingSpeed 150ms

Hide

Type "source C:/Users/张云康/.bashrc"
Enter

Type "clear"
Enter
Sleep 1s

Type "ps"
Sleep 3s

Ctrl+G
Sleep 2s

Show
Sleep 1s

Hide
Type "view cpu status"
Sleep 2s
Enter

Sleep 2s

Show
Sleep 1s

Enter
Sleep 1s
