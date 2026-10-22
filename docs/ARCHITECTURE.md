# 本地 UI 组件资源库架构文档

版本：0.1.0  
日期：2026-10-22

## 1. 架构概览

```text
浏览器
  │
  │ HTTP
  ▼
Node.js 本地服务
  ├─ 静态文件服务：C:\E\ui\src
  ├─ 组件索引 API：/api/components
  ├─ 手动扫描 API：POST /api/scan
  ├─ 预览文件 API：/preview/*
  └─ 组件下载 API：/api/download
          │
          ▼
    C:\E\ui\library 只读素材
          │
          ▼
    C:\E\ui\data\components.json
    C:\E\ui\data\overrides.json
    C:\E\ui\data\settings.json

独立 MCP 服务
  ├─ 默认 stdio：node mcp-server.mjs
  ├─ 可选 HTTP：POST http://127.0.0.1:49184/mcp
  └─ 共享 library-core.mjs 的扫描器、索引和路径安全边界
```

## 2. 运行方式

- 运行时：Node.js，ES Module。
- 默认本地地址：`http://127.0.0.1:49183`；网站启动器固定使用该端口，被占用时提示用户关闭旧进程，不自动切换端口。
- 启动命令：`npm start`。
- 网站前端位于 `src/index.html`、`src/app.js` 和 `src/style.css`。
- 后端入口为 `server.mjs`。
- 当前不依赖公网服务和外部数据库。
- 全库适配审计通过 `npm run audit` 执行，报告写入 `C:\E\ui\logs`，覆盖入口、资源、模块依赖、Tailwind 适配和可访问性。
- 预览运行时会把外部字体、图片和 CDN 脚本改为本地兼容层或本地占位资源；原始源码不会被重写。
- 主页面使用细窄紫色滚动条；UI 预览 iframe 内部滚动条统一隐藏，避免卡片广场出现无法操作的滚动条；分类栏继续隐藏视觉滚动条但保留滚轮/触控板滚动能力。
- 卡片预览不再根据悬停时间切换内部滚轮。预览 iframe 作为展示层不参与鼠标命中测试，因此页面滚轮始终由主页面原生处理，行为与侧边栏一致；源码详情只保留右侧 `.detail-info` 一个可用滚动层，详情预览不会再抢占第二条滚动条。
- 页面滚动期间仅暂停预览动画和媒体，不注入滚轮桥接、不调用父页面 `scrollBy`，避免 iframe 与主页面之间产生回弹或卡住。
- 分页策略为“当前页完整加载、下一页低优先级预取”：当前页 48 个卡片直接创建 iframe，保证页面内滚动时不会出现白块；下一页只通过 `link[rel=prefetch]` 预取 HTML，不创建 iframe，切换到下一页后才完整运行该页组件。
- 打开详情弹窗时保留当前页已经加载的卡片 iframe，不主动卸载或暂停，让它们继续保持原有状态。
- 为避免 48 个已加载 iframe 的动画同时抢占滚动帧，使用 `IntersectionObserver` 暂停视口外预览的 CSS 动画；主页面进入全局滚动状态时暂时暂停当前页全部预览动画和媒体，滚动停止后恢复。iframe、源码和卡片 DOM 均不卸载，因此不会出现白块。
- 详情弹窗只保留 `.detail-info` 一个纵向滚动层；源码 `pre` 自动换行并展开，不再嵌套第二个纵向滚动条，避免查看代码时滚轮竞争和卡顿。详情信息区显示细窄深灰滚动条，主页面使用紫色滚动条。

## 3. 扫描器设计

### 3.1 输入

固定读取：`C:\E\ui\library`。

扫描器递归遍历目录，跳过 `.git` 和 `node_modules`，读取文件路径、扩展名、大小和修改时间。

### 3.2 入口选择

同一目录下优先选择以下文件作为组件预览入口：

1. `preview.html`
2. `index.html`
3. `demo.html`
4. `fullscreen.html`

如果目录没有以上入口，则将目录下每个 HTML 文件视为独立组件。

如果目录没有 HTML 入口，则将 `.vue`、`.jsx` 或 `.tsx` 文件作为可索引入口，并据此识别 Vue 或 React 技术栈。当前素材库实际检测到的入口全部是 HTML，因此当前索引技术栈为 HTML/CSS/JS。

### 3.3 元数据

每个索引组件包含：

```json
{
  "id": "稳定哈希",
  "name": "组件名称",
  "category": "分类",
  "tags": ["标签"],
  "sourcePath": "相对 library 的入口路径",
  "directory": "组件目录",
  "author": "可选作者",
  "framework": "技术类型",
  "size": 0,
  "modified": 0,
  "files": ["关联文件相对路径"]
}
```

### 3.4 分类规则

优先从路径中识别已知分类：Buttons、Cards、Tooltips、Notifications、Radio-buttons、Toggle-switches、Inputs、Forms、Patterns、Preloaders、Page-transitions、Scroll-transitions 和 Scroll-trigger。

未命中时使用入口文件所在的上级目录，无法判断时归入 Other。

## 4. 前端设计

### 4.1 首页状态

前端维护以下状态：

- 全部组件列表。
- 当前分类。
- 当前搜索词。
- 当前排序方式。
- 当前打开的组件。

页面布局使用左侧固定分类栏和独立主内容滚动容器：分类按钮纵向排列并贴左边，分类栏只滚动自己的内容并通过 `overscroll-behavior` 阻断滚动链；主内容区按侧栏宽度留出空间，`main` 自己滚动卡片列表并使用定制紫色滚动条，两者互不串联。

顶部工具栏提供“硬件加速”开关。开启后为卡片预览、详情预览和滚动网格增加 GPU 合成提示；状态以 `C:\E\ui\data\settings.json` 为本地服务端持久化来源，并通过 `/api/settings` 读取和保存。刷新、重启 Node 服务或端口变化后仍自动恢复，只有手动关闭才会写入关闭状态；浏览器本地缓存仅作为服务不可用时的回退。

### 4.2 组件预览

- 卡片使用 iframe 加载 `/preview/{按路径段编码的相对路径}`，保留目录分隔符，确保入口中的 `./src/style.css`、`./src/demo.js` 能正确解析。
- iframe 使用 `sandbox="allow-scripts allow-same-origin"`，以支持可信本地组件的 `sessionStorage`、样式和脚本交互。
- 详情预览复用同一入口路径。
- 对预览运行时的裸依赖 `gsap`、`gsap/ScrollTrigger`、`lenis` 提供本地兼容模块；源码查看通过 `?raw=1` 返回原始文件，避免把运行时改写内容显示给用户。
- 对 Uiverse 独立 HTML 中常见的 Tailwind 工具类提供离线适配层，并为独立元素增加居中预览容器，避免未加载 Tailwind 时退化为原生控件。
- 对运行时外部资源提供离线回退：GSAP、ScrollTrigger、Barba 走 `/vendor` 本地 shim；远程图片走本地 SVG 占位图；远程字体链接被省略。
- 源码使用文件接口读取并显示，不把源码硬编码到前端；二进制资源不作为文本源码展开。
- 首页使用每页 48 个组件的分页，避免一次创建数千个 iframe。
- 当前页卡片 iframe 的 `src` 在分页渲染时立即设置；下一页只预取入口 HTML，真正切页后才创建并运行下一页 iframe。
- 打开详情弹窗不等待源码请求完成：先显示预览和元数据，再异步填充源码；源码请求使用当前会话内存缓存与请求复用，空闲时预热同组件的其他文本文件，避免重复读取造成等待。

### 4.3 手动元数据

- 详情页允许编辑名称、分类和标签。
- 修改内容写入 `data/overrides.json`，重新扫描时保留。
- 原始素材和扫描得到的基础元数据不被修改。

### 4.4 下载

- 下载请求只接受索引中存在的组件 ID。
- 后端根据索引组件目录生成 ZIP。
- 下载源目录必须经过 `C:\E\ui\library` 路径边界校验。
- 原始素材不被移动或修改。

## 5. 安全边界

- 服务只监听 `127.0.0.1`。
- 所有素材路径通过绝对路径边界校验。
- 禁止通过 URL 读取 `library` 之外的文件。
- 预览脚本运行在 iframe sandbox 中。
- 下载目录来自服务端索引，不能由客户端任意拼接。

## 6. 后续扩展点

### AI / 知识库

在索引生成后增加文本描述、源码摘要、组件关系和向量索引。

### MCP 与 Skill

`mcp-server.mjs` 使用零外部依赖的 JSON-RPC MCP 实现，默认 stdio，使用 `--http` 启动本地 HTTP 传输。它同时提供现代 `server/discover`（2026-07-28）和旧版 `initialize` 握手回退，方便新旧客户端连接。网站服务和 MCP 服务共享 `library-core.mjs`，保证扫描结果、ID、分类、标签和路径规则一致。

提供以下工具：

- `scan_ui_library`
- `search_ui_components`
- `get_ui_component`
- `get_ui_source`
- `get_ui_preview`
- `find_similar_components`
- `get_library_status`

搜索先匹配元数据，必要时读取组件关联文本文件执行源码全文搜索；相似推荐使用名称、分类、标签、路径、框架和源码词法重叠计算，不使用向量化。Skill 位于 `skills/local-ui-library/SKILL.md`，包含 Codex、Cursor 等客户端的连接示例和调用顺序。

### 数据库

当前 JSON 索引适合第一版。组件数量继续增长或需要编辑历史后，可迁移到 SQLite，保留相同字段和 API。
