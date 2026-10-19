# Answer the app's native open/save dialog: find the #32770 dialog owned by
# the given process through UI Automation, then set the file name box and
# press the default button with window messages to their own handles. No
# keystrokes, so nothing can land in another window.
param([int]$ProcessId, [string]$FileName, [int]$TimeoutMs = 20000)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@
$A = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
function Cond($prop, $value) { New-Object System.Windows.Automation.PropertyCondition($prop, $value) }
function Find($root, $id) {
  $root.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.AndCondition(
    (Cond $A::AutomationIdProperty $id), (Cond $A::ClassNameProperty $(if ($id -eq "1") { "Button" } else { "Edit" })))))
}

$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
$dialog = $null
while (-not $dialog -and (Get-Date) -lt $deadline) {
  foreach ($w in $A::RootElement.FindAll($Scope::Children, (Cond $A::ProcessIdProperty $ProcessId))) {
    if ($w.Current.ClassName -eq "#32770") { $dialog = $w; break }
  }
  if (-not $dialog) { Start-Sleep -Milliseconds 250 }
}
if (-not $dialog) { Write-Error "no dialog for pid $ProcessId"; exit 1 }

# 1001: the Save dialog's file name edit; 1148: the Open dialog's.
$edit = (Find $dialog "1001"), (Find $dialog "1148") | Where-Object { $_ } | Select-Object -First 1
$ok = Find $dialog "1"
if (-not $edit -or -not $ok) { Write-Error "no file name box or default button"; exit 1 }
[void][W]::SendMessage([IntPtr]$edit.Current.NativeWindowHandle, 0x000C, [IntPtr]::Zero, $FileName) # WM_SETTEXT
Start-Sleep -Milliseconds 200
[void][W]::PostMessage([IntPtr]$ok.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) # BM_CLICK
Write-Output "answered '$($dialog.Current.Name)': $FileName"
