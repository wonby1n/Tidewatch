# Tidewatch 펫 — 작업표시줄 위를 걸어다니면서 전체 세션 현황을 보여준다 (Windows 전용)
#   powershell -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%USERPROFILE%\.tidewatch\pet.ps1"
param([string]$Dir = (Join-Path $HOME '.tidewatch'))

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

# 펫은 하나만
$mutex = New-Object System.Threading.Mutex($false, 'Local\TidewatchPet')
if (-not $mutex.WaitOne(0)) { return }

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Tidewatch" WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ShowActivated="False" ResizeMode="NoResize"
        Width="240" Height="118">
  <Canvas>
    <Border x:Name="Bubble" Canvas.Top="2" CornerRadius="10" Padding="9,4" Background="#3B82F6" Cursor="Hand">
      <TextBlock x:Name="BubbleText" Foreground="White" FontFamily="Malgun Gothic" FontSize="12" FontWeight="Bold"
                 MaxWidth="216" TextTrimming="CharacterEllipsis"/>
    </Border>
    <Canvas x:Name="Bot" Width="48" Height="58" Canvas.Left="96" Canvas.Top="58" Cursor="Hand" Background="Transparent">
      <Canvas.RenderTransform>
        <TransformGroup>
          <ScaleTransform x:Name="Flip" CenterX="24"/>
          <RotateTransform x:Name="Tilt" CenterX="24" CenterY="52"/>
          <TranslateTransform x:Name="Hop"/>
        </TransformGroup>
      </Canvas.RenderTransform>
      <Line X1="24" Y1="6" X2="24" Y2="14" Stroke="#14202B" StrokeThickness="2.5"/>
      <Ellipse x:Name="Ant" Canvas.Left="19.5" Canvas.Top="0.5" Width="9" Height="9" Fill="#3B82F6" Stroke="#14202B" StrokeThickness="1.5"/>
      <Rectangle x:Name="Head" Canvas.Left="6" Canvas.Top="13" Width="36" Height="27" RadiusX="9" RadiusY="9" Fill="White" Stroke="#14202B" StrokeThickness="2.5"/>
      <Ellipse x:Name="EyeL" Canvas.Left="14" Canvas.Top="22" Width="7" Height="7" Fill="#14202B"/>
      <Ellipse x:Name="EyeR" Canvas.Left="27" Canvas.Top="22" Width="7" Height="7" Fill="#14202B"/>
      <TextBlock x:Name="Face" Canvas.Left="6" Canvas.Top="16" Width="36" TextAlignment="Center" FontFamily="Consolas"
                 FontSize="14" FontWeight="Bold" Foreground="#14202B" Visibility="Collapsed"/>
      <Rectangle x:Name="Body" Canvas.Left="14" Canvas.Top="40" Width="20" Height="11" RadiusX="5" RadiusY="5" Fill="White" Stroke="#14202B" StrokeThickness="2.5"/>
      <Rectangle x:Name="LegL" Canvas.Left="17" Canvas.Top="50" Width="4" Height="7" RadiusX="2" RadiusY="2" Fill="#14202B"/>
      <Rectangle x:Name="LegR" Canvas.Left="27" Canvas.Top="50" Width="4" Height="7" RadiusX="2" RadiusY="2" Fill="#14202B"/>
    </Canvas>
  </Canvas>
</Window>
'@

$win = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$n = @{}
foreach ($name in 'Bubble','BubbleText','Bot','Flip','Tilt','Hop','Ant','Head','EyeL','EyeR','Face','Body','LegL','LegR') { $n[$name] = $win.FindName($name) }
$brush = { param($hex) (New-Object System.Windows.Media.BrushConverter).ConvertFromString($hex) }

$colors = @{ waiting = '#FF7A3D'; blocked = '#EF4444'; working = '#3B82F6'; done = '#22C55E'; sleep = '#64748B' }
$labels = @{ waiting = '너 차례'; blocked = '막힘'; working = '작업 중'; done = '끝' }
$state = @{ mood = 'sleep'; dir = 1; t = 0.0; still = $false; tip = ''; dragging = $false }

# --- 화면 위치: 작업표시줄 바로 위 ---
$area = [System.Windows.SystemParameters]::WorkArea
$screenLeft = [System.Windows.SystemParameters]::VirtualScreenLeft
$screenTop = [System.Windows.SystemParameters]::VirtualScreenTop
$screenRight = $screenLeft + [System.Windows.SystemParameters]::VirtualScreenWidth
$screenBottom = $screenTop + [System.Windows.SystemParameters]::VirtualScreenHeight
$posFile = Join-Path $Dir 'pet.json'

function Go-Home {
  $win.Top = $area.Bottom - $win.Height + 1
  $win.Left = $area.Left + ($area.Width - $win.Width) * 0.8
}

function Save-Position {
  try { @{ left = [int]$win.Left; top = [int]$win.Top } | ConvertTo-Json | Set-Content -Encoding UTF8 $posFile } catch {}
}

# 예전에 옮겨 둔 자리가 있고 화면 안이면 거기서 시작
Go-Home
try {
  $saved = Get-Content -Raw -Encoding UTF8 $posFile | ConvertFrom-Json
  if ($saved.left -ge $screenLeft -and $saved.left -le $screenRight - 60 -and $saved.top -ge $screenTop -and $saved.top -le $screenBottom - 60) {
    $win.Left = $saved.left; $win.Top = $saved.top
  }
} catch {}

# --- 세션 읽기 ---
function Read-Sessions {
  $now = Get-Date
  $list = @()
  $folder = Join-Path $Dir 'sessions'
  if (-not (Test-Path $folder)) { return $list }
  foreach ($f in Get-ChildItem $folder -Filter *.json -ErrorAction SilentlyContinue) {
    $age = ($now - $f.LastWriteTime).TotalMinutes
    if ($age -gt 4320) { continue }
    try { $s = Get-Content -Raw -Encoding UTF8 $f.FullName | ConvertFrom-Json }
    catch { $s = [pscustomobject]@{ status = 'blocked'; title = $f.BaseName } }
    $status = "$($s.status)"
    if (-not $labels.ContainsKey($status)) { $status = 'working' }
    if ($status -eq 'done' -and $age -gt 1440) { continue }
    $title = "$($s.title)"
    if (-not $title) { $title = $f.BaseName }
    $list += [pscustomobject]@{ status = $status; title = $title; now = "$($s.now)"; age = $age }
  }
  return $list
}

function Short([string]$text, [int]$max) {
  if ($text.Length -le $max) { return $text }
  return $text.Substring(0, $max) + '…'
}

function Refresh {
  $list = @(Read-Sessions)
  $count = @{}
  foreach ($k in $labels.Keys) { $count[$k] = @($list | Where-Object { $_.status -eq $k }).Count }
  $first = { param($k) $list | Where-Object { $_.status -eq $k } | Sort-Object age | Select-Object -First 1 }
  $awake = @($list | Where-Object { $_.status -eq 'working' -and $_.age -lt 30 }).Count

  if ($count.waiting -gt 0) { $mood = 'waiting'; $s = & $first 'waiting'; $text = "너 차례 $($count.waiting) · $(Short $s.title 16)" }
  elseif ($count.blocked -gt 0) { $mood = 'blocked'; $s = & $first 'blocked'; $text = "막힘 $($count.blocked) · $(Short $s.title 16)" }
  elseif ($awake -gt 0) { $mood = 'working'; $text = "작업 중 $($count.working)" }
  elseif ($count.working -gt 0) { $mood = 'sleep'; $text = "작업 중 $($count.working) · 30분째 조용함" }
  elseif ($count.done -gt 0) { $mood = 'done'; $text = "다 끝났어요 ✓ $($count.done)" }
  else { $mood = 'sleep'; $text = 'zZ' }

  $state.mood = $mood
  $n.BubbleText.Text = $text
  $n.Bubble.Background = & $brush $colors[$mood]
  $n.Ant.Fill = & $brush $colors[$mood]

  $faces = @{ blocked = 'x  x'; done = '^  ^'; sleep = '-  -' }
  $face = $faces[$mood]
  $eyes = if ($face) { 'Collapsed' } else { 'Visible' }
  $n.EyeL.Visibility = $eyes; $n.EyeR.Visibility = $eyes
  $n.Face.Text = $face
  $n.Face.Visibility = if ($face) { 'Visible' } else { 'Collapsed' }

  if ($list.Count -eq 0) { $tip = '진행 중인 세션이 없어요' }
  else {
    $order = @{ waiting = 0; blocked = 1; working = 2; done = 3 }
    $tip = ($list | Sort-Object { $order[$_.status] }, age | ForEach-Object { "● $($labels[$_.status]) · $($_.title)" }) -join "`n"
  }
  $n.Bot.ToolTip = $tip
  $n.Bubble.ToolTip = $tip
  $n.Bubble.UpdateLayout()
  [System.Windows.Controls.Canvas]::SetLeft($n.Bubble, [Math]::Max(0, (240 - $n.Bubble.ActualWidth) / 2))
}

# --- 움직임 ---
function Tick {
  $state.t += 0.033
  $t = $state.t
  $n.Tilt.Angle = 0; $n.Hop.Y = 0
  [System.Windows.Controls.Canvas]::SetTop($n.LegL, 50); [System.Windows.Controls.Canvas]::SetTop($n.LegR, 50)
  switch ($state.mood) {
    'working' {
      if (-not $state.still -and -not $state.dragging) {
        $next = $win.Left + 1.3 * $state.dir
        if ($next -lt $screenLeft -or $next -gt $screenRight - $win.Width) { $state.dir = -$state.dir } else { $win.Left = $next }
        $n.Flip.ScaleX = $state.dir
        $step = [Math]::Sin($t * 12)
        [System.Windows.Controls.Canvas]::SetTop($n.LegL, 50 - [Math]::Max(0, $step) * 3)
        [System.Windows.Controls.Canvas]::SetTop($n.LegR, 50 - [Math]::Max(0, -$step) * 3)
      }
      $n.Hop.Y = -[Math]::Abs([Math]::Sin($t * 12)) * 2
    }
    'waiting' { $n.Hop.Y = -[Math]::Abs([Math]::Sin($t * 6)) * 9; $n.Tilt.Angle = [Math]::Sin($t * 6) * 6 }
    'blocked' { $n.Tilt.Angle = -10 + [Math]::Sin($t * 45) * 3 }
    'done'    { $n.Hop.Y = -[Math]::Abs([Math]::Sin($t * 3)) * 4 }
    default   { $n.Tilt.Angle = [Math]::Sin($t * 1.2) * 3 }
  }
  # 가끔 눈 깜빡
  $blink = ($t % 4) -lt 0.12
  $h = if ($blink) { 1.5 } else { 7 }
  $n.EyeL.Height = $h; $n.EyeR.Height = $h
}

# --- 메뉴와 클릭 ---
function Open-Board {
  $script = Join-Path $Dir 'tidewatch.mjs'
  Start-Process -FilePath 'node' -ArgumentList "`"$script`" app" -WindowStyle Hidden
}

$startupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Tidewatch Pet.lnk'

function New-MenuEntry($header, $onClick) {
  $item = New-Object System.Windows.Controls.MenuItem
  $item.Header = $header
  $item.Add_Click($onClick)
  return $item
}

$menu = New-Object System.Windows.Controls.ContextMenu
[void]$menu.Items.Add((New-MenuEntry '현황판 열기' { Open-Board }))
$notifyItem = New-MenuEntry '알림 받기' {
  $on = -not $notifyItem.IsChecked
  $mode = if ($on) { 'on' } else { 'off' }
  Start-Process -FilePath 'node' -ArgumentList "`"$(Join-Path $Dir 'tidewatch.mjs')`" notify $mode" -WindowStyle Hidden
  $notifyItem.IsChecked = $on
}
[void]$menu.Items.Add($notifyItem)
$stillItem = New-MenuEntry '가만히 있기' { $state.still = -not $state.still; $stillItem.IsChecked = $state.still }
[void]$menu.Items.Add($stillItem)
$startupItem = New-MenuEntry 'Windows 시작할 때 켜기' {
  if (Test-Path $startupLink) { Remove-Item $startupLink -Force }
  else {
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($startupLink)
    $lnk.TargetPath = 'powershell.exe'
    $lnk.Arguments = "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
    $lnk.WindowStyle = 7
    $ico = Join-Path $Dir 'tidewatch.ico'
    if (Test-Path $ico) { $lnk.IconLocation = "$ico,0" }
    $lnk.Save()
  }
  $startupItem.IsChecked = Test-Path $startupLink
}
[void]$menu.Items.Add($startupItem)
[void]$menu.Items.Add((New-Object System.Windows.Controls.Separator))
[void]$menu.Items.Add((New-MenuEntry '작업표시줄로 돌아가기' { Go-Home; Remove-Item $posFile -Force -ErrorAction SilentlyContinue }))
[void]$menu.Items.Add((New-Object System.Windows.Controls.Separator))
[void]$menu.Items.Add((New-MenuEntry '펫 끄기' { $win.Close() }))
$menu.Add_Opened({
  $conf = $null
  try { $conf = Get-Content -Raw -Encoding UTF8 (Join-Path $Dir 'settings.json') | ConvertFrom-Json } catch {}
  $notifyItem.IsChecked = -not ($conf -and $conf.notify -eq $false)
  $startupItem.IsChecked = Test-Path $startupLink
  $stillItem.IsChecked = $state.still
})
$win.ContextMenu = $menu

# 짧게 누르면 현황판, 누른 채 끌면 옮기기
$drag = @{ down = $false; moved = $false; x = 0.0; y = 0.0 }
$onDown = {
  param($sender, $e)
  $p = $e.GetPosition($win)
  $drag.down = $true; $drag.moved = $false; $drag.x = $p.X; $drag.y = $p.Y
}
$onMove = {
  param($sender, $e)
  if (-not $drag.down -or $e.LeftButton -ne 'Pressed') { return }
  $p = $e.GetPosition($win)
  if ([Math]::Abs($p.X - $drag.x) + [Math]::Abs($p.Y - $drag.y) -lt 5) { return }
  $drag.moved = $true; $drag.down = $false
  $state.dragging = $true
  try { $win.DragMove() } catch {}
  $state.dragging = $false
  Save-Position
}
$onUp = {
  param($sender, $e)
  if ($drag.down -and -not $drag.moved) { Open-Board }
  $drag.down = $false
}
foreach ($el in @($n.Bot, $n.Bubble)) {
  $el.Add_MouseLeftButtonDown($onDown)
  $el.Add_MouseMove($onMove)
  $el.Add_MouseLeftButtonUp($onUp)
}

# --- 타이머 ---
$anim = New-Object System.Windows.Threading.DispatcherTimer
$anim.Interval = [TimeSpan]::FromMilliseconds(33)
$anim.Add_Tick({ Tick })
$poll = New-Object System.Windows.Threading.DispatcherTimer
$poll.Interval = [TimeSpan]::FromSeconds(2)
$poll.Add_Tick({ Refresh })

$win.Add_Loaded({ Refresh; $anim.Start(); $poll.Start() })
$win.Add_Closed({ $anim.Stop(); $poll.Stop(); $mutex.ReleaseMutex() })
[void]$win.ShowDialog()
