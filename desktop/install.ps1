# Install a locally built Tidewatch desktop app without changing existing sessions.
param([string]$Source = (Join-Path $PSScriptRoot '..\release\Tidewatch-win32-x64'))
$ErrorActionPreference = 'Stop'
$Source = [IO.Path]::GetFullPath($Source)
if (-not (Test-Path -LiteralPath (Join-Path $Source 'Tidewatch.exe'))) { throw 'Build the app first: npm ci; npm run package:win' }
if (-not (Test-Path -LiteralPath (Join-Path $Source 'resources\app\skills\tidewatch\scripts\tidewatch.mjs'))) { throw 'Incomplete app bundle. Run npm run package:win again.' }
$Board = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.tidewatch'
$Target = Join-Path $Board 'desktop'
New-Item -ItemType Directory -Force -Path $Target | Out-Null
Copy-Item -Path (Join-Path $Source '*') -Destination $Target -Recurse -Force
# An older archived bundle takes precedence over resources/app; remove only that stale app file.
$OldArchive = Join-Path $Target 'resources\app.asar'
if (Test-Path -LiteralPath $OldArchive) { Remove-Item -LiteralPath $OldArchive -Force }
$Exe = Join-Path $Target 'Tidewatch.exe'
$Utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $Board 'desktop.json'), (@{ executable = $Exe } | ConvertTo-Json), $Utf8)
$Bundled = Join-Path $Target 'resources\app\skills\tidewatch'
Copy-Item -LiteralPath (Join-Path $Bundled 'scripts\tidewatch.mjs') -Destination (Join-Path $Board 'tidewatch.mjs') -Force
Copy-Item -LiteralPath (Join-Path $Bundled 'scripts\usage.mjs') -Destination (Join-Path $Board 'usage.mjs') -Force
foreach ($SkillRoot in @('.claude\skills', '.agents\skills', '.codex\skills')) {
  if ($SkillRoot -eq '.codex\skills' -and -not (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex'))) { continue }
  $SkillTarget = Join-Path ([Environment]::GetFolderPath('UserProfile')) (Join-Path $SkillRoot 'tidewatch')
  New-Item -ItemType Directory -Force -Path $SkillTarget | Out-Null
  Copy-Item -Path (Join-Path $Bundled '*') -Destination $SkillTarget -Recurse -Force
}
$DesktopPath = [Environment]::GetFolderPath('Desktop')
if ($DesktopPath) {
  $Shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $DesktopPath 'Tidewatch.lnk'))
  $Shortcut.TargetPath = $Exe
  $Shortcut.WorkingDirectory = $Target
  $Shortcut.IconLocation = "$Exe,0"
  $Shortcut.Description = 'Tidewatch - AI session board'
  $Shortcut.Save()
}
Write-Host "Installed: $Exe"
Write-Host 'Open Tidewatch from your desktop. Existing sessions are preserved.'
