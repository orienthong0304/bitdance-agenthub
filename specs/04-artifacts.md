# Spec 04 — Artifacts

> Artifact 是 Agent 产出的「可独立预览的产物」：网页 / 代码 / 文档 / 图片 / diff。**与 Message 解耦**，有独立的生命周期、版本、二次编辑。**修改 ArtifactContent 结构需先讨论。**

源文件：`src/shared/types.ts`、`src/db/schema.ts`、`src/server/artifact-service.ts`、`src/components/artifact-preview-panel.tsx`、`src/server/tools/write-artifact.ts`、`src/server/tools/deploy-artifact.ts`

---

## 设计原则

1. **独立于 Message**（CLAUDE.md §3.5）：产物有自己的 DB 行，不内联在 message.parts 的字符串里
2. **消息只持有引用** —— `artifact_ref` part 引用 artifactId（详见 Spec 03）
3. **版本链 via parent**：v2 在 `parentArtifactId` 指向 v1，物理上是新一行
4. **5 种 type 共享一张表**：用 `content: JSON` 列存可辨联合，按 `type` 字段分发
5. **来源唯一**：Agent 通过 `write_artifact` 工具创建；不允许 Adapter / 前端直接写 artifacts 表

---

## ArtifactContent 五种 type

源：`src/shared/types.ts:38-68`

```typescript
type ArtifactContent =
  | { type: 'web_app'; files: Record<string, string>; entry: string }
  | { type: 'code_file'; workspacePath: string; language: string; sizeBytes: number; checksum: string }
  | { type: 'diff'; targetArtifactId: string; hunks: DiffHunk[]; applied: boolean }
  | { type: 'document'; format: 'markdown'; content: string }
  | { type: 'image'; url: string; alt: string; width?: number; height?: number }
```

### 存储策略对照

| type | 内容存哪 | 用途 | 写入工具 |
|---|---|---|---|
| `web_app` | **DB JSON 列**（files: Record<path, source>） | 完整 HTML/CSS/JS 包，iframe 渲染 | `write_artifact` |
| `document` | **DB JSON 列**（content: markdown 字符串） | 文档 / 报告 / 说明 | `write_artifact` |
| `image` | **DB JSON 列**（url + alt + 可选尺寸） | URL 或 data URI | `write_artifact` |
| `diff` | **DB JSON 列**（hunks 列表 + 目标 artifactId） | 对其它 artifact 的修改 | TODO（未实装） |
| `code_file` | **仅 workspacePath 入 DB**，文件本身在 workspace 文件系统 | 大代码文件 / 多文件项目 | TODO（未实装） |

**为什么 code_file 不入 DB**：代码文件可能 MB 级，塞 SQLite JSON 列会卡。改为 workspace 引用 + checksum 校验。但这个路径需要配合「workspace 文件读写工具」（bash / fs_write，详见 Spec 07 TODO），所以目前 `write_artifact` 也不接受 `code_file` type（`tools/write-artifact.ts:21`）。

---

## MVP 限制

`write_artifact` 工具当前 `type` 只接：`'web_app' | 'document' | 'image'`。`code_file` / `diff` 留作下一阶段。

源码 `src/server/tools/write-artifact.ts:21`：
```typescript
const ArgsSchema = z.object({
  type: z.enum(['web_app', 'document', 'image']),
  title: z.string().min(1),
  content: z.unknown(),
})
```

---

## DB 行结构

源：`src/db/schema.ts:88-109`（详见 Spec 08）

```typescript
artifacts {
  id                  // art_<nanoid>
  conversation_id     // FK → conversations.id (cascade)
  type                // ArtifactType
  title               // 人读标题
  content             // JSON: ArtifactContent
  version             // int, default 1
  parent_artifact_id  // 版本链（v2 → v1），不建外键
  created_by_agent_id // FK → agents.id
  created_at
}
INDEX idx_artifacts_conv ON (conversation_id)
```

`ArtifactRow` = drizzle inferred `$inferSelect`。

`ArtifactRecord`（用于事件 payload，`types.ts:117-127`）：字段同 row，但 `parentArtifactId` optional（兼容旧 emit 路径）。

---

## 写入路径：write_artifact 工具

源文件：`src/server/tools/write-artifact.ts`

### 参数容错（drift）

handler 接受 4 种 `content` 形状，归一化到标准 `ArtifactContent`：

| 输入形态（content 字段） | 归一化目标 | 例子 |
|---|---|---|
| `{ files: { ... }, entry }` | 直接用 | 标准 web_app |
| `{ html, css?, js? }` | 映射到 `index.html` / `style.css` / `script.js` | `{ html: '<div/>', css: 'body{}' }` |
| `{ content: '<html>...' }` 或 `{ code: '...' }` | 单文件 `index.html` | LLM 喜欢用 `content` 键 |
| 裸字符串 `'<html>...'` | 同上 | LLM 直接给 HTML |

document 类似：`{ content }` / `{ markdown }` / `{ text }` / 裸字符串都接受。

image 接受 `{ url, alt? }` 或裸 URL 字符串。

**为什么宽松**：LLM 即使按 JSON Schema 生成也会漂移。宁可在工具入口归一化，也不要因为参数键不对就直接 fail（用户感知是 agent「无故失败」）。

### 写入流程

```
1. zod 校验 type / title
2. buildArtifactContent(type, content) 归一化 → ArtifactContent | null
   null 则返回 ok:false
3. INSERT artifacts (id=art_<nanoid>, version=1, ...)
4. 返回 ok:true, value: { artifactId, title, type }

不做的事：
- 不直接 emit artifact.create 事件
- 不直接给 message 加 artifact_ref part
```

### 后续注入路径

write_artifact 只入库 + 返回 artifactId。**Adapter** 在 tool_result 之后检测到 result.value.artifactId 时：

1. 从 DB 拉完整 artifact row
2. yield `{ type: 'artifact.create', artifact: <row> }` 事件
3. AgentRunner 接到 artifact.create → 给当前 message 末尾 push `artifact_ref` part 并补发 `part.start`

这样事件流单一来源（Adapter emit），DB 写入单一来源（工具 handler），互不串味。

---

## 渲染契约

源：`src/components/artifact-preview-panel.tsx`

### 入口：ArtifactPreviewPanel

```
store.previewArtifactId → ArtifactPreviewPanel
                              │ 按 content.type 分发
                              ▼
   ┌─────────┬─────────────┬─────────┬───────────────┬─────────┐
   │ web_app │  document   │  image  │   code_file   │  diff   │
   │         │             │         │   (P1)        │  (P1)   │
   └─────────┴─────────────┴─────────┴───────────────┴─────────┘
```

### web_app

`WebAppView`：
- 上方 tab 切「预览 / 源码」
- 预览：`<iframe src="/api/artifacts/:id/preview" sandbox="allow-scripts">`（**没有 allow-same-origin**，详见 CLAUDE.md §5.1）
- 源码：选文件 dropdown + `<pre><code>` 显示（**TODO**：源码视图也走 shiki 高亮）
- `buildIframeHtml`：共享 helper，自动把 `style.css` / `script.js` 注入到 `index.html` 的 `</head>` / `</body>` 前；裸 HTML 片段会自动包成完整 doc

### 一键预览 URL

`GET /api/artifacts/:id/preview` 只服务 `web_app` artifact，返回 `text/html`，并设置 CSP sandbox / `nosniff` / `no-store`。前端 artifact 卡和部署状态卡用该路径生成当前 origin 下的完整预览 URL。

`deploy_artifact` 不做外部托管，返回本地预览部署记录：

```typescript
{
  id: 'dep_xxx',
  artifactId: 'art_xxx',
  title: string,
  version: number,
  previewPath: '/api/artifacts/art_xxx/preview',
  status: 'ready' | 'failed',
  error?: string,
  createdAt: number
}
```

### document

`DocumentView`：直接走 `<Markdown>`（同消息气泡里 text part 的渲染），含 shiki 高亮的 fenced code block。

### image

`ImageView`：`<img>` 居中 + 灰底，限制 max-h/max-w 防超出面板。

### code_file（P1）

`CodeFileView`：当前仅显示 metadata（workspacePath / language / sizeBytes），主体是「需要从 workspace 加载文件内容才能渲染」的提示。等 bash/fs 工具实装后补完。

### diff（P1）

未实装，显示「Diff 视图开发中」。

---

## 卡片入口：artifact_ref part

源：`src/components/message-parts.tsx:205-273`

`<ArtifactRefPart artifactId>`：

1. `useAppStore.artifacts[id]` 读
2. 若不在 store，`fetchArtifact(id)`：
   - 200 → `upsertArtifact(row)`
   - 404 → 渲染「产物已删除」墓碑卡片（type=document/web_app 等都灰化）
3. 命中后渲染：图标 + title + `type · v<version> · 点击预览`
4. 点击 → `openArtifactPreview(id)` 触发右侧面板滑入

---

## 删除

源：`DELETE /api/artifacts/[id]` → `artifact-service.deleteArtifact`

直接 `DELETE FROM artifacts WHERE id = ?`。**不删除引用该 artifact 的 message 里的 artifact_ref part**（part 仍存，前端 lazy fetch 时 404 显示墓碑）。

会话级 cascade：删除 conversation → `artifacts` 表通过 FK `ON DELETE CASCADE` 自动清空。

---

## 版本链（TODO）

字段已就绪：`artifacts.parent_artifact_id` + `version` 列。

事件类型已定义：`StreamEvent 'artifact.update'`（`types.ts:109`）—— payload `{ artifactId, patch: Partial<ArtifactContent> }`。

前端 reducer 已就绪：`app-store.ts:391-396` 接 `artifact.update`，浅合并 patch。

**缺什么**：
- 没有「写新版本」的工具（`write_artifact` 总是写 v1）
- Adapter 也没有 emit `artifact.update` 的路径
- UI 没有「编辑产物 → 提交新版本」的入口

要实装版本链，需要：
1. 新增 `update_artifact` 工具（或扩展 write_artifact 接受 `parentArtifactId`）
2. Adapter 在工具结果后 emit `artifact.update` 或 `artifact.create`（新 id 但 parentArtifactId 指向旧）
3. 前端 ArtifactPreviewPanel 加「历史版本」侧边栏

---

## 列表 / 全局视图

源：`GET /api/artifacts` → `listArtifacts()`

`ArtifactLibrary` 组件（在 sidebar 第三个 tab）：
- 列出全部产物按 `createdAt` 降序
- 一次性 JOIN 出 `conversationTitle`（避免 N+1）
- 点击进入对应会话并打开预览面板
- 删除按钮 → DELETE API

---

## 安全 / 沙箱

- **web_app 的 iframe 必须 `sandbox="allow-scripts"`，绝不加 `allow-same-origin`**（CLAUDE.md §5.1）。LLM 生成的 JS 可能尝试访问宿主 cookie / localStorage，必须隔离
- **web_app 的 preview route 必须设置 CSP sandbox**，和 iframe sandbox 形成双层约束
- **document 的 markdown 由 react-markdown 渲染**，默认不开启原生 HTML（避免 XSS）。如要支持 HTML，需要走 sanitize
- **image 的 url**：可以是 `https://...` 或 `data:image/...;base64,...`。LLM 当前主要产 data URI（base64 编码的小图）。SVG data URI 仍可触发 XSS（SVG 内含 script），建议未来用 `<img>` 的 origin 隔离或 sanitize SVG

---

## 与其它 spec 的关系

- Spec 01：Artifact 实体的字段定义
- Spec 02：`artifact.create` / `artifact.update` 事件，artifact_ref part 注入路径
- Spec 03：MessagePart 的 `artifact_ref` 类型
- Spec 07：`write_artifact` 工具规格
- Spec 08：artifacts 表 + 索引 + cascade 关系
- Spec 09：ArtifactPreviewPanel 与 ArtifactRefPart 渲染
