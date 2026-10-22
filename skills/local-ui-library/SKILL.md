---
name: local-ui-library
description: Search, inspect, preview, scan, and recommend components from the local UI library at C:/E/ui/library through the local-ui-library MCP server. Use this when the user asks for a local UI example, source code, preview, category, tag, or similar component.
---

# Local UI Library Skill

This Skill connects an AI client to the local UI library through MCP. It is local-only and does not require Ollama, a model server, a vector database, or an internet connection.

## Connection

Preferred stdio configuration:

```json
{
  "mcpServers": {
    "local-ui-library": {
      "command": "node",
      "args": ["C:\\E\\ui\\mcp-server.mjs"]
    }
  }
}
```

Optional HTTP configuration:

```json
{
  "mcpServers": {
    "local-ui-library": {
      "url": "http://127.0.0.1:49184/mcp"
    }
  }
}
```

Start the HTTP transport with `C:\E\ui\start-ui-library-mcp.bat` or `npm run mcp:http`. The PowerShell launcher checks `49184-49204` and prints the actual selected URL when the default port is occupied.

## Tool workflow

1. Call `get_library_status` before answering questions about available components.
2. Call `search_ui_components` for a name, category, tag, style, behavior, or source keyword.
3. Call `get_ui_component` when the user needs metadata or an exact component reference.
4. Call `get_ui_source` only for the requested component and file; do not read the whole library unnecessarily.
5. Call `get_ui_preview` when the user wants to see or open the running local preview.
6. Call `find_similar_components` for related examples. This uses lexical metadata/source terms, not embeddings.
7. Call `scan_ui_library` only when the user explicitly asks to rescan or add newly copied folders.

## Search behavior

- Search covers component metadata and source text.
- Results are local and deterministic.
- `vectorSearch` and `ollama` are intentionally false in the current phase.
- Never claim semantic/vector similarity; describe recommendations as keyword/tag/source similarity.
- Preserve the original `C:\E\ui\library` files. Scanning updates only `C:\E\ui\data` and `C:\E\ui\logs`.

## Response behavior

When returning a component, include its name, category, source path, framework, preview URL, and the exact MCP tool used. When returning source, identify the relative file path and say if the result was truncated.

