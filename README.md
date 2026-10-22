# Local UI MCP Skill

本项目是一个本地 UI 组件库工作台，包含：

- `src/`：本地 UI 组件广场网站前端
- `server.mjs`：本地网站服务
- `library-core.mjs`：UI 扫描、索引与安全路径处理
- `mcp-server.mjs`：本地 MCP 服务，支持搜索、源码、预览、扫描和相似组件推荐
- `skills/local-ui-library/SKILL.md`：Codex Skill
- `start-ui-library-mcp.ps1` / `start-ui-library-mcp.bat`：一键启动 MCP 服务
- `docs/`：需求、架构和交付文档
- `library/`：本地 UI 组件素材库

## 本地运行

需要 Node.js 18 或更高版本。

```powershell
cd C:\E\ui
npm test
npm start
```

网站默认使用项目目录下的 `library/`、`data/` 和 `logs/`。如需更换 UI 库根目录，可设置 `UI_LIBRARY_ROOT` 环境变量。

## MCP

网站固定使用 `http://127.0.0.1:49183/`，MCP HTTP 固定使用 `http://127.0.0.1:49184/mcp`；端口被占用时启动器会提示并退出，不会自动改用其他端口。

标准输入输出模式：

```powershell
node mcp-server.mjs
```

HTTP 模式：

```powershell
.\start-ui-library-mcp.ps1
```

当前实现使用 JSON 索引、关键词全文检索和词法相似推荐，不依赖 Ollama、向量数据库或外部服务。

