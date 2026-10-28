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
$Icon = Join-Path $Board 'tidewatch.ico'
Copy-Item (Join-Path $Src 'assets\tidewatch.ico') $Icon -Force
Copy-Item (Join-Path $Src 'assets\tidewatch.png') (Join-Path $Board 'tidewatch.png') -Force
$Page = node (Join-Path $Board 'tidewatch.mjs') build
if ($Tmp) { Remove-Item -Recurse -Force $Tmp }

# Desktop shortcut: opens the board as a chromeless app window (Edge/Chrome --app)
$Browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
try {
  $Desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $Desktop) { throw 'no Desktop folder' }
  $Link = Join-Path $Desktop 'Tidewatch.lnk'
  $Shell = New-Object -ComObject WScript.Shell
  $Shortcut = $Shell.CreateShortcut($Link)
  if ($Browser) {
    $Shortcut.TargetPath = $Browser
    $Shortcut.Arguments = "--app=`"$(([Uri]$Page).AbsoluteUri)`" --window-size=460,940"
  } else {
    $Shortcut.TargetPath = $Page
  }
  $Shortcut.IconLocation = "$Icon,0"
  $Shortcut.Description = 'Tidewatch - AI session board'
  $Shortcut.Save()
  Write-Host "  + Desktop shortcut: $Link"
} catch {
  Write-Host "  (Skipped the desktop shortcut: $($_.Exception.Message))"
  Write-Host "  Open it any time with: node `"$Board\tidewatch.mjs`" app"
}

Write-Host ''
Write-Host "Done! Open the Tidewatch icon on your desktop and keep the board open." -ForegroundColor Green
Write-Host 'Then tell Claude Code or Codex: "turn on tidewatch".'
