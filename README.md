# Codex 聊天记录（VS Code 扩展）

在 VS Code 里直接翻阅本机 Codex 的历史会话。插件只读取 Codex 自己保存的 rollout 记录，不修改、不上传任何数据。

## 功能

- 侧栏按「今天 / 昨天 / 最近 7 天 / 最近 30 天 / 更早」分组列出全部 Codex 会话，标题取自 Codex 的会话索引。
- 聊天面板按气泡还原对话：你的消息、Codex 回复、思考过程、工具调用输入/输出、用户截图。
- 工具调用与思考过程默认折叠，可单条展开，也可一键展开/收起全部。
- 面板内搜索（`Ctrl+F`），支持过滤消息、工具输入和输出。
- 跨会话全文搜索：命令面板执行 **Codex: 在全部会话内容中搜索**，命中后直接跳到对应消息。
- 点击回复里的本地文件链接可直接打开对应文件与行号；`http(s)` 链接用系统浏览器打开。
- 一键导出为 Markdown，或打开原始 `.jsonl` 记录。
- 监听 `sessions/**/*.jsonl`，会话进行中也能刷新/自动更新。
- 跟随 VS Code 明暗主题，除 VS Code 本身外无第三方依赖。

## 安装

方式一：在 VSIX 所在目录执行命令行安装。

```powershell
code --install-extension .\dist\codex-chat-history-1.0.0.vsix
```

方式二：VS Code 里打开「扩展」视图，点右上角 `...` → **从 VSIX 安装…**，选择 `dist\codex-chat-history-1.0.0.vsix`。

安装后左侧活动栏会出现 **Codex 聊天** 图标；也可以按 `Ctrl+Shift+P` 执行 **Codex: 打开聊天记录**。

## 数据来源

默认读取 `~/.codex`（Windows 为 `C:\Users\<你>\.codex`）：

- `sessions/**/rollout-*.jsonl`：完整会话记录
- `session_index.jsonl`：会话标题与更新时间
- `archived_sessions/**`：可选的已归档会话

如果设置了环境变量 `CODEX_HOME`，或 Codex 数据在别处，请在设置里修改：

```json
{
  "codexHistory.codexHome": "D:\\path\\to\\.codex"
}
```

插件只做只读解析。删除、归档、修改会话仍需在 Codex 中操作。

## 设置

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `codexHistory.codexHome` | 空 | Codex 数据目录，留空时用 `CODEX_HOME` 或 `~/.codex` |
| `codexHistory.maxSessions` | `300` | 侧栏最多显示的会话数 |
| `codexHistory.showArchived` | `false` | 是否显示已归档会话 |
| `codexHistory.groupByDate` | `true` | 是否按日期分组 |
| `codexHistory.showToolCalls` | `true` | 是否显示工具调用 |
| `codexHistory.showReasoning` | `true` | 是否显示思考过程 |
| `codexHistory.expandToolCalls` | `false` | 是否默认展开工具调用 |

## 命令

- `Codex: 打开聊天记录`
- `Codex: 刷新会话列表`
- `Codex: 筛选会话列表` / `Codex: 清除会话筛选`
- `Codex: 只看当前工作区的会话`
- `Codex: 在全部会话内容中搜索`
- `Codex: 打开 Codex 数据目录`

会话条目的右键菜单还可以导出 Markdown、打开原始记录、在文件资源管理器中显示。

## 已知限制

- 只解析 Codex rollout 的 `response_item` / `event_msg` 结构；如果未来 Codex 改了记录格式，插件需要同步适配。
- 思考过程只有在记录里存在明文摘要时才会显示。Codex 常见的加密 reasoning 内容无法解密，因此不会显示。
- 用户消息中内嵌的图片只在有 `input_image` 数据时显示；历史版本可能只记录文本。
- 全文搜索会流式读取全部会话文件，会话很多时第一次搜索会有几秒耗时。

## 开发与打包

```powershell
cd codex-chat-history
npm test
npm run build:vsix
```

`npm test` 会用真实的本机会话做冒烟校验；打包脚本零依赖，直接生成 VSIX。
想在开发时快速看渲染效果，可执行 `node scripts/preview.js`，它会用最近的真实会话生成一份静态预览页面并打印路径。
打包结果默认写入项目内的 `dist\`，也可以通过 `node scripts/build-vsix.js <输出目录>` 指定其他位置。

项目结构：

```
extension.js         激活入口、命令、文件监听
src/parser.js        rollout JSONL 解析
src/store.js         会话索引、缓存、全文搜索
src/tree.js          侧栏树
src/panel.js         Webview 聊天面板
src/exporter.js      Markdown 导出与本地链接跳转
src/markdownExport.js 导出格式
media/               面板样式、Markdown 渲染、交互脚本
test/                解析与渲染测试
scripts/build-vsix.js 零依赖 VSIX 打包
```
