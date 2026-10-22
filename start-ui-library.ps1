param(
  [int]$PreferredPort = 49183,
  [switch]$KillPortOwner
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Write-Host '未找到 Node.js，请先安装 Node.js 或把 node 加入 PATH。' -ForegroundColor Red
  Read-Host '按 Enter 退出'
  exit 1
}
$nodePath = if ($nodeCommand.Source) { $nodeCommand.Source } else { $nodeCommand.Path }

$selectedPort = $PreferredPort
$currentProcessId = $PID
$portOwners = @(Get-NetTCPConnection -State Listen -LocalPort $selectedPort -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
if ($KillPortOwner -and $portOwners.Count -gt 0) {
  foreach ($ownerProcessId in $portOwners) {
    if ($ownerProcessId -eq $currentProcessId) { continue }
    try {
      $owner = Get-Process -Id $ownerProcessId -ErrorAction Stop
      Write-Host "固定端口 $selectedPort 已被 $($owner.ProcessName) (PID $ownerProcessId) 占用，正在结束该进程..." -ForegroundColor Yellow
      Stop-Process -Id $ownerProcessId -Force -ErrorAction Stop
    } catch {
      Write-Host "无法结束端口 $selectedPort 的占用进程 PID $ownerProcessId：$($_.Exception.Message)" -ForegroundColor Red
      Read-Host '按 Enter 退出'
      exit 1
    }
  }
  Start-Sleep -Milliseconds 300
}

$listener = $null
try {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $selectedPort)
  $listener.Start()
  $listener.Stop()
} catch {
  if ($null -ne $listener) { $listener.Stop() }
  Write-Host "固定端口 $selectedPort 已被占用，未启动服务。请关闭占用该端口的旧 UI Library 进程后重试。" -ForegroundColor Red
  Read-Host '按 Enter 退出'
  exit 1
}

$env:UI_LIBRARY_PORT = $selectedPort
$url = "http://127.0.0.1:$selectedPort/"
Write-Host "UI Library 正在启动：$url" -ForegroundColor Cyan
Write-Host '关闭此窗口即可停止服务。' -ForegroundColor DarkGray

$browserJob = Start-Job -ArgumentList $url -ScriptBlock {
  param($browserUrl)
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $browserUrl -TimeoutSec 1
      if ($response.StatusCode -eq 200) {
        Start-Process $browserUrl
        return
      }
    } catch { }
    Start-Sleep -Milliseconds 250
  }
  Start-Process $browserUrl
}

try {
  & $nodePath (Join-Path $projectRoot 'server.mjs')
} finally {
  if ($browserJob) {
    Stop-Job -Job $browserJob -ErrorAction SilentlyContinue
    Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
  }
}
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  Write-Host "服务已退出，代码：$exitCode" -ForegroundColor Red
} else {
  Write-Host '服务已停止。' -ForegroundColor Yellow
}
Read-Host '按 Enter 退出'
exit $exitCode
