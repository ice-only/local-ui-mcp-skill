param(
  [int]$PreferredPort = 49184,
  [int]$PortAttempts = 21
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '未找到 Node.js，请先安装 Node.js 或把 node 加入 PATH。' -ForegroundColor Red
  Read-Host '按 Enter 退出'
  exit 1
}

$selectedPort = $null
for ($offset = 0; $offset -lt $PortAttempts; $offset++) {
  $candidate = $PreferredPort + $offset
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
    $listener.Start()
    $listener.Stop()
    $selectedPort = $candidate
    break
  } catch {
    if ($null -ne $listener) { $listener.Stop() }
  }
}

if ($null -eq $selectedPort) {
  Write-Host "端口 ${PreferredPort}-${($PreferredPort + $PortAttempts - 1)} 全部被占用，未启动 MCP。" -ForegroundColor Red
  Read-Host '按 Enter 退出'
  exit 1
}

$env:UI_LIBRARY_MCP_PORT = $selectedPort
Write-Host "Local UI Library MCP 正在启动：http://127.0.0.1:$selectedPort/mcp" -ForegroundColor Cyan
Write-Host '关闭此窗口即可停止 MCP HTTP 服务。' -ForegroundColor DarkGray

& node (Join-Path $projectRoot 'mcp-server.mjs') --http
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  Write-Host "MCP 服务已退出，代码：$exitCode" -ForegroundColor Red
} else {
  Write-Host 'MCP 服务已停止。' -ForegroundColor Yellow
}
Read-Host '按 Enter 退出'
exit $exitCode
