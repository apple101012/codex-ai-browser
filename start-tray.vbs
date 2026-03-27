Set oShell = CreateObject("WScript.Shell")
sDir = oShell.CurrentDirectory
Set oFSO = CreateObject("Scripting.FileSystemObject")
sDir = oFSO.GetParentFolderName(WScript.ScriptFullName)
oShell.CurrentDirectory = sDir
oShell.Run "cmd /c npm run desktop:dev", 0, False
