# Codex History Lens 竖版宣传片

一套面向 VS Code 扩展的 9:16 产品短片，中英各一条。两条片子共用同一套
Pillow 渲染代码，只替换 `timeline.*.json` 里的文案、配音和字体。

## 成片

| 语言 | 平台 | 时长 | 文件 |
| --- | --- | --- | --- |
| 中文 | 快手（抖音 / 视频号可直接复用） | 50.1 s | `zh/codex-history-lens-kuaishou-zh-1080x1920.mp4` |
| 英文 | YouTube Shorts | 44.3 s | `en/codex-history-lens-youtube-en-1080x1920.mp4` |

每条片子交付三件套：

```
codex-history-lens-<platform>-<lang>-1080x1920.mp4
codex-history-lens-<platform>-<lang>-cover-1080x1920.png
codex-history-lens-<platform>-<lang>.md
```

## 目录

```
video/
├─ README.md
├─ zh/
│  ├─ codex-history-lens-kuaishou-zh-1080x1920.mp4
│  ├─ codex-history-lens-kuaishou-zh-cover-1080x1920.png
│  └─ codex-history-lens-kuaishou-zh.md
└─ en/
   ├─ codex-history-lens-youtube-en-1080x1920.mp4
   ├─ codex-history-lens-youtube-en-cover-1080x1920.png
   └─ codex-history-lens-youtube-en.md

video-src/
├─ style.py            品牌色、字体、图标、背景、窗口与聊天气泡工具
├─ render_video.py     7 个镜头的逐帧合成与 ffmpeg 编码
├─ build_assets.py     edge-tts 配音、numpy 配乐、混音与时长回填
├─ timeline.zh.json    中文唯一事实源
├─ timeline.en.json    英文唯一事实源
├─ requirements.txt
└─ build/              可重新生成的音频与预览帧（不入库）
```

## 规格

- 画幅：9:16，1080×1920，30 fps
- 视频：H.264 High、`yuv420p`、CRF 18、2 秒固定 GOP
- 音频：AAC 192 kbps、48 kHz、立体声
- 响度：单遍 `loudnorm` 到约 −14 LUFS，真峰值 ≤ −1 dBFS
- 容器：MP4 + `+faststart`

## 结构

| 时间（中文版） | 镜头 | 作用 |
| --- | --- | --- |
| 0–5.8 s | 翻不到昨天的对话 | 用“只记得大概”抛痛点 |
| 5.8–13.2 s | Codex History Lens | 品牌落版与一句话定位 |
| 13.2–20.5 s | 按天分组的历史侧栏 | 今天 / 昨天 / 具体日期 |
| 20.5–28.3 s | 完整聊天面板 | 消息、思考过程、工具调用可展开 |
| 28.3–34.9 s | 跨会话全文搜索 | 命中后直接跳到消息 |
| 34.9–42.7 s | 本地优先 | 不上传、无遥测、Markdown 导出 |
| 42.7–50.1 s | 扩展商店安装 | 行动号召与搜索词 |

## 重新生成

环境要求：Windows、Python 3.10+、能访问 edge-tts 的网络。字体使用系统自带的
Microsoft YaHei、Segoe UI 和 Cascadia Mono。

```powershell
cd D:\github\codex-chat-history\video-src
python -m pip install -r requirements.txt
python build_assets.py --lang all
python render_video.py --lang all
```

只重出中文：

```powershell
python build_assets.py --lang zh
python render_video.py --lang zh
```

只渲染某一帧检查排版：

```powershell
python render_video.py --lang zh --still 23.4
```

## 质检

```powershell
# 完整解码并查看真实流参数
ffmpeg -hide_banner -i .\zh\codex-history-lens-kuaishou-zh-1080x1920.mp4 -f null NUL

# 抽关键帧
ffmpeg -hide_banner -y -ss 4  -i .\zh\codex-history-lens-kuaishou-zh-1080x1920.mp4 -frames:v 1 chk_4.png
ffmpeg -hide_banner -y -ss 23 -i .\zh\codex-history-lens-kuaishou-zh-1080x1920.mp4 -frames:v 1 chk_23.png
ffmpeg -hide_banner -y -ss 46 -i .\zh\codex-history-lens-kuaishou-zh-1080x1920.mp4 -frames:v 1 chk_46.png

# 实测响度
ffmpeg -hide_banner -i .\zh\codex-history-lens-kuaishou-zh-1080x1920.mp4 `
  -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null NUL
```

检查清单：

- 1080×1920、30 fps、时长与 `timeline.total` 相差小于 0.1 s
- H.264 High / `yuv420p`，AAC 48 kHz 立体声
- 真峰值 ≤ −1 dBFS，整体响度约 −14 LUFS
- 首帧不是黑屏，末帧停在扩展商店安装
- 字幕底部在 1550 px 以上，避开平台标题和按钮
- 中英文分别出片，不做双语字幕叠排

## 素材与授权

- 配音：`edge-tts`，中文 `zh-CN-YunxiNeural`，英文 `en-US-AndrewNeural`
- 配乐与 whoosh：`numpy` 实时合成，无第三方音乐素材
- 字体：系统自带 Microsoft YaHei、Segoe UI、Cascadia Mono
- 界面、图标、会话列表均为代码重绘，示例数据与 README 一致

成片单条体积较大，建议默认不入 Git，走 GitHub Release 或对象存储分发。
