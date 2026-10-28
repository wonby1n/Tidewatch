# Tidewatch installer (Windows PowerShell)
#   irm https://raw.githubusercontent.com/wonby1n/tidewatch/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$Raw = 'https://raw.githubusercontent.com/wonby1n/tidewatch/main'
$Src = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'skills\tidewatch' } else { '' }
$Tmp = $null

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Tidewatch needs Node.js. Install it from https://nodejs.org and run this again.' -ForegroundColor Red
  return
}

if (-not $Src -or -not (Test-Path (Join-Path $Src 'SKILL.md'))) {
  $Tmp = Join-Path ([IO.Path]::GetTempPath()) ("tidewatch-" + [guid]::NewGuid())
  $Src = Join-Path $Tmp 'tidewatch'
  New-Item -ItemType Directory -Force -Path (Join-Path $Src 'scripts') | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Src 'assets') | Out-Null
  Invoke-WebRequest "$Raw/skills/tidewatch/SKILL.md" -OutFile (Join-Path $Src 'SKILL.md') -UseBasicParsing
  Invoke-WebRequest "$Raw/skills/tidewatch/scripts/tidewatch.mjs" -OutFile (Join-Path $Src 'scripts\tidewatch.mjs') -UseBasicParsing
  Invoke-WebRequest "$Raw/skills/tidewatch/scripts/usage.mjs" -OutFile (Join-Path $Src 'scripts\usage.mjs') -UseBasicParsing
  Invoke-WebRequest "$Raw/skills/tidewatch/scripts/pet.ps1" -OutFile (Join-Path $Src 'scripts\pet.ps1') -UseBasicParsing
  Invoke-WebRequest "$Raw/skills/tidewatch/assets/tidewatch.ico" -OutFile (Join-Path $Src 'assets\tidewatch.ico') -UseBasicParsing
  Invoke-WebRequest "$Raw/skills/tidewatch/assets/tidewatch.png" -OutFile (Join-Path $Src 'assets\tidewatch.png') -UseBasicParsing
}

function Install-To($dir) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $target = Join-Path $dir 'tidewatch'
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Copy-Item -Recurse $Src $target
  Write-Host "  + $target"
}

Write-Host 'Installing the Tidewatch skill'
Install-To (Join-Path $HOME '.claude\skills')     # Claude Code
Install-To (Join-Path $HOME '.agents\skills')     # Codex
if (Test-Path (Join-Path $HOME '.codex')) { Install-To (Join-Path $HOME '.codex\skills') }  # older Codex versions

$Board = Join-Path $HOME '.tidewatch'
New-Item -ItemType Directory -Force -Path $Board | Out-Null
Copy-Item (Join-Path $Src 'scripts\tidewatch.mjs') (Join-Path $Board 'tidewatch.mjs') -Force
Copy-Item (Join-Path $Src 'scripts\usage.mjs') (Join-Path $Board 'usage.mjs') -Force
$Icon = Join-Path $Board 'tidewatch.ico'
Copy-Item (Join-Path $Src 'assets\tidewatch.ico') $Icon -Force
Copy-Item (Join-Path $Src 'assets\tidewatch.png') (Join-Path $Board 'tidewatch.png') -Force
$Pet = Join-Path $Board 'pet.ps1'
# stop a running pet so the new version starts below
try {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop |
    Where-Object { $_.CommandLine -like '*\.tidewatch\pet.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}
Copy-Item (Join-Path $Src 'scripts\pet.ps1') $Pet -Force
# keep a copy of the skill so the app's "connect" button can install it for Claude Code / Codex
$SkillCopy = Join-Path $Board 'skill'
if (Test-Path $SkillCopy) { Remove-Item -Recurse -Force $SkillCopy }
Copy-Item -Recurse $Src $SkillCopy
# restart the local app server so the new version is used
$ServerPid = Join-Path $Board 'server.pid'
if (Test-Path $ServerPid) {
  try { Stop-Process -Id ([int](Get-Content $ServerPid)) -Force -ErrorAction Stop } catch {}
  Remove-Item $ServerPid -Force -ErrorAction SilentlyContinue
}
$Page = node (Join-Path $Board 'tidewatch.mjs') build
if ($Tmp) { Remove-Item -Recurse -Force $Tmp }

# Desktop shortcut: opens Tidewatch (local app server + chromeless window). Pet, notifications and
# Claude Code / Codex connections are all controlled inside the app.
$NodeExe = (Get-Command node).Source
try {
  $Desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $Desktop) { throw 'no Desktop folder' }
  $Link = Join-Path $Desktop 'Tidewatch.lnk'
  $Shell = New-Object -ComObject WScript.Shell
  $Shortcut = $Shell.CreateShortcut($Link)
  $Shortcut.TargetPath = $NodeExe
  $Shortcut.Arguments = "`"$(Join-Path $Board 'tidewatch.mjs')`" app"
  $Shortcut.WindowStyle = 7
  $Shortcut.IconLocation = "$Icon,0"
  $Shortcut.Description = 'Tidewatch - AI session board'
  $Shortcut.Save()
  Write-Host "  + Desktop shortcut: $Link"
  $OldPet = Join-Path $Desktop 'Tidewatch Pet.lnk'
  if (Test-Path $OldPet) { Remove-Item $OldPet -Force }
} catch {
  Write-Host "  (Skipped the desktop shortcut: $($_.Exception.Message))"
  Write-Host "  Open it any time with: node `"$Board\tidewatch.mjs`" app"
}

try {
  Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Pet`"" -WindowStyle Hidden
  Write-Host '  + Pet started (turn it on/off inside the Tidewatch app)'
} catch { Write-Host "  (Could not start the pet: $($_.Exception.Message))" }

Write-Host ''
Write-Host "Done! Open the Tidewatch icon on your desktop." -ForegroundColor Green
Write-Host 'Then tell Claude Code or Codex: "turn on tidewatch".'
