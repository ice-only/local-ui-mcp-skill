param(
  [int]$PreferredPort = 49184
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
$listener = $null
try {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $selectedPort)
  $listener.Start()
  $listener.Stop()
} catch {
  if ($null -ne $listener) { $listener.Stop() }
  Write-Host "固定端口 $selectedPort 已被占用，未启动 MCP。请关闭占用该端口的旧 MCP 进程后重试。" -ForegroundColor Red
  Read-Host '按 Enter 退出'
  exit 1
}

$env:UI_LIBRARY_MCP_PORT = $selectedPort
Write-Host "Local UI Library MCP 正在启动：http://127.0.0.1:$selectedPort/mcp" -ForegroundColor Cyan
Write-Host '关闭此窗口即可停止 MCP HTTP 服务。' -ForegroundColor DarkGray

& $nodePath (Join-Path $projectRoot 'mcp-server.mjs') --http
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  Write-Host "MCP 服务已退出，代码：$exitCode" -ForegroundColor Red
} else {
  Write-Host 'MCP 服务已停止。' -ForegroundColor Yellow
}
Read-Host '按 Enter 退出'
exit $exitCode
