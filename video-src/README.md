# video-src

Codex History Lens 竖版宣传片的源码。画面用 Pillow 逐帧绘制，音频用 edge-tts
与 numpy 生成，最后通过 rawvideo 管道直接推给 ffmpeg。

## 文件

- `style.py`：品牌色、字体、图标、背景、窗口、聊天气泡与文字工具
- `render_video.py`：8 个镜头、转场、封面、ffmpeg 编码
- `build_assets.py`：逐镜头 TTS、配乐、混音、时长回填
- `timeline.zh.json` / `timeline.en.json`：文案与时间的唯一事实源

## 命令

```powershell
python -m pip install -r requirements.txt
python build_assets.py --lang all
python render_video.py --lang all
```

`build_assets.py` 会回填每个镜头的 `audio`、`start`、`dur`、`vo_at` 和全局
`total`。时长规则是：

```python
dur = max(min, audio + 1.15)
vo_at = 0.62
```

修改文案后只需重跑这两条命令。TTS 文件按文本哈希缓存，未改动的镜头不会重新合成。

## 注意

- 字体路径写死为 `C:\Windows\Fonts`，跨机器先确认字体存在。
- Cascadia Mono 不包含中文字形；中文文案不要使用 `mono` 字体，否则会出现方框。
- `build/` 是中间产物，已忽略；最终成片在 `../video/`。
- 画面里的 VS Code 窗口、会话列表和聊天面板是代码重绘，不是真实截图。
