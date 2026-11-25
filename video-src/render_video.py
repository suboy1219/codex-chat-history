from __future__ import annotations

import argparse
import json
import math
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

import style as st

ROOT = Path(__file__).resolve().parent
VIDEO = ROOT.parent / "video"
W, H, FPS = st.W, st.H, st.FPS

NAME = {
    "zh": {
        "platform": "kuaishou",
        "video": "codex-history-lens-kuaishou-zh-1080x1920.mp4",
        "cover": "codex-history-lens-kuaishou-zh-cover-1080x1920.png",
    },
    "en": {
        "platform": "youtube",
        "video": "codex-history-lens-youtube-en-1080x1920.mp4",
        "cover": "codex-history-lens-youtube-en-cover-1080x1920.png",
    },
}


def scene_base() -> Image.Image:
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def reveal_visual(layer: Image.Image, visual: Image.Image, local: float,
                  delay: float = 0.14) -> None:
    p = st.reveal(local, delay, 0.62)
    if p > 0:
        layer.alpha_composite(st.with_alpha(visual, p))


def draw_kicker(layer: Image.Image, text: str, local: float, fb: st.FontBook,
                accent) -> None:
    p = st.reveal(local, 0.02, 0.45)
    color = st.mix(st.BG, accent, p)
    y = 326 + int((1 - p) * 14)
    if fb.lang == "zh":
        st.draw_tracked(layer, (84, y), text, fb.f("bold", 29), color, tracking=1.2)
    else:
        st.draw_tracked(layer, (84, y), text, fb.f("mono", 24), color, tracking=2.0)


def draw_headline(layer: Image.Image, text: str, local: float, fb: st.FontBook,
                  max_size: int = 118) -> None:
    p = st.reveal(local, 0.08, 0.56)
    lines = text.split("\n")
    f = fb.fit("bold", lines, max_size if fb.lang == "zh" else max_size - 4, 912)
    color = st.mix(st.BG, st.TEXT, p)
    y = 384 + int((1 - p) * 28)
    st.draw_lines(layer, (84, y), lines, f, color, spacing=2)


def draw_bubble(layer: Image.Image, box: tuple[float, float, float, float],
                lines: list[tuple[str, str]], fb: st.FontBook, radius: int = 18) -> None:
    st.rounded(layer, box, radius, fill=(30, 41, 56), outline=(48, 62, 80))
    x1, y1, _, _ = box
    y = y1 + 16
    for kind, text in lines:
        size = {"mono": 17, "small": 16}.get(kind, 21)
        f = fb.f("mono" if kind == "mono" else "regular", size)
        color = {"mono": st.TOOL, "small": st.MUTED}.get(kind, st.TEXT)
        ImageDraw.Draw(layer).text((x1 + 18, y), text, font=f, fill=color)
        y += int(size * 1.45)


def draw_highlight_text(layer: Image.Image, x: float, y: float, text: str,
                        target: str, font, color, hl_bg, hl_color) -> None:
    draw = ImageDraw.Draw(layer)
    low = text.lower()
    idx = low.find(target.lower())
    if idx < 0:
        draw.text((x, y), text, font=font, fill=color)
        return
    before = text[:idx]
    hit = text[idx:idx + len(target)]
    after = text[idx + len(target):]
    wb = font.getlength(before)
    wh = font.getlength(hit)
    draw.rounded_rectangle((x + wb - 3, y - 3, x + wb + wh + 3, y + font.size + 5),
                           radius=4, fill=hl_bg)
    draw.text((x, y), before, font=font, fill=color)
    draw.text((x + wb, y), hit, font=font, fill=hl_color)
    draw.text((x + wb + wh, y), after, font=font, fill=color)


def draw_scene_s1(local: float, fb: st.FontBook, scene: dict) -> Image.Image:
    layer = scene_base()
    vis = scene_base()
    zh = fb.lang == "zh"
    accent = st.WARM

    st.card(vis, (110, 720, 970, 1280), radius=30, fill=(16, 21, 30),
            outline=(49, 61, 78), top_glow=True)
    for i, col in enumerate(((248, 109, 109), (255, 189, 96), (82, 201, 128))):
        st.circle(vis, (134 + i * 21, 742, 146 + i * 21, 754), fill=col)
    ImageDraw.Draw(vis).text((218, 748), "Codex · 会话" if zh else "Codex · session",
                             font=fb.f("bold" if zh else "regular", 19),
                             fill=st.MUTED, anchor="lm")
    ImageDraw.Draw(vis).text((944, 748), "3 days ago" if not zh else "3 天前",
                             font=fb.f("mono" if not zh else "regular", 15),
                             fill=st.FAINT, anchor="rm")
    ImageDraw.Draw(vis).line((110, 772, 970, 772), fill=(39, 50, 65), width=1)

    p1 = st.reveal(local, 0.10, 0.5)
    if p1 > 0:
        st.rounded(vis, (590, 798, 938, 872), 18,
                   fill=st.mix(st.BG, (0, 92, 162), p1))
        f = fb.f("regular", 20)
        text = "帮我把登录跳转修一下" if zh else "Fix the login redirect"
        ImageDraw.Draw(vis).text((610, 835), text,
                                 font=fb.fit("regular", [text], 20, 308),
                                 fill=st.mix(st.BG, (238, 246, 255), p1), anchor="lm")

    p2 = st.reveal(local, 0.22, 0.5)
    if p2 > 0:
        st.rounded(vis, (142, 894, 824, 1012), 18,
                   fill=st.mix(st.BG, (26, 35, 48), p2), outline=(45, 58, 74))
        lines = (["已更新 src/auth/redirect.ts", "顺手补了一条回归测试"]
                 if zh else ["Updated src/auth/redirect.ts", "Added a regression test"])
        f1 = fb.f("mono" if not zh else "regular", 17)
        f2 = fb.f("regular", 19)
        ImageDraw.Draw(vis).text((162, 922), lines[0], font=f1,
                                 fill=st.mix(st.BG, st.TOOL, p2))
        ImageDraw.Draw(vis).text((162, 958), lines[1], font=f2,
                                 fill=st.mix(st.BG, st.TEXT, p2))

    p3 = st.reveal(local, 0.40, 0.45)
    if p3 > 0:
        st.rounded(vis, (142, 1030, 824, 1080), 12,
                   fill=st.mix(st.BG, (20, 28, 39), p3), outline=(42, 54, 69))
        st.circle(vis, (160, 1050, 170, 1060), fill=st.mix(st.BG, st.TOOL, p3))
        ImageDraw.Draw(vis).text((184, 1055), "npm test  ·  24 passed",
                                 font=fb.f("mono", 16),
                                 fill=st.mix(st.BG, st.MUTED, p3), anchor="lm")

    p4 = st.reveal(local, 0.38, 0.45)
    if p4 > 0:
        st.rounded(vis, (142, 1108, 938, 1184), 14,
                   fill=st.mix(st.BG, (8, 13, 20), p4),
                   outline=st.mix(st.BG, st.ACCENT, p4 * 0.8), width=2)
        st.draw_search(vis, 174, 1146, 11, st.mix(st.BG, st.MUTED, p4), 3)
        typed = ("登录跳转" if zh else "login redirect")
        cut = int(len(typed) * st.clamp01((local - 0.95) / 0.7))
        fq = fb.f("mono" if not zh else "regular", 22)
        ImageDraw.Draw(vis).text((202, 1147), typed[:cut],
                                 font=fq, fill=st.mix(st.BG, st.TEXT, p4), anchor="lm")
        if cut < len(typed) and int(local * 2.2) % 2 == 0:
            cx = 202 + fq.getlength(typed[:cut]) + 3
            ImageDraw.Draw(vis).line((cx, 1133, cx, 1162), fill=st.ACCENT, width=2)
        st.draw_spinner(vis, 914, 1146, 10, local, st.mix(st.BG, st.MUTED, p4))

    p5 = st.reveal(local, 1.62, 0.4)
    if p5 > 0:
        ImageDraw.Draw(vis).text((162, 1218),
                                 "没有匹配的会话" if zh else "No matching sessions",
                                 font=fb.f("bold", 20),
                                 fill=st.mix(st.BG, st.DANGER, p5))
        ImageDraw.Draw(vis).text((936, 1218), "0 条" if zh else "0 results",
                                 font=fb.f("regular" if zh else "mono", 16),
                                 fill=st.mix(st.BG, st.DANGER, p5), anchor="ra")
        ImageDraw.Draw(vis).line((162, 1250, 936, 1250),
                                 fill=st.mix(st.BG, (55, 38, 44), p5), width=1)

    chips = [
        ("哪个分支？" if zh else "which branch?", 764, 1292, 214 if zh else 262, 1.10),
        ("改的哪一行？" if zh else "which line?", 38, 1292, 238 if zh else 214, 1.35),
    ]
    for text, x, y, cw, delay in chips:
        p = st.reveal(local, delay, 0.45)
        if p <= 0:
            continue
        yy = y + int((1 - p) * 16) + int(2.5 * math.sin(local * 2.2 + delay * 5))
        st.draw_chip(vis, x, yy, cw, 56, text, fb, 17 if zh else 15,
                     fg=st.mix(st.BG, st.TEXT, p),
                     bg=st.mix(st.BG, (30, 38, 51), p),
                     border=st.mix(st.BG, (72, 84, 100), p),
                     dot=st.mix(st.BG, accent, p), mono=not zh)

    reveal_visual(layer, vis, local)
    draw_kicker(layer, scene["kicker"], local, fb, accent)
    draw_headline(layer, scene["headline"], local, fb)
    st.draw_sub(layer, fb, scene["sub"].split("\n"), local, accent)
    return layer


def draw_scene_s2(local: float, fb: st.FontBook, scene: dict) -> Image.Image:
    layer = scene_base()
    vis = scene_base()
    zh = fb.lang == "zh"
    cx, cy = 540, 884

    for i in range(5, 0, -1):
        r = 156 + i * 40 + 5 * math.sin(local * 1.1 - i * 0.4)
        st.circle(vis, (cx - r, cy - r, cx + r, cy + r),
                  outline=st.mix(st.BG, st.ACCENT, 0.055 * (6 - i) / 5 + 0.015), width=2)

    pop = st.ease_out(local / 0.75)
    size = int(292 * (0.92 + 0.08 * pop))
    icon = st.make_icon(size)
    vis.alpha_composite(icon, (cx - size // 2, cy - size // 2))

    name = "Codex History Lens"
    fname = fb.fit("bold", [name], 66, 900)
    ImageDraw.Draw(vis).text((cx, 1078), name, font=fname, fill=st.TEXT, anchor="mm")
    tagline = ("本机 Codex 会话浏览器" if zh
               else "A local Codex session browser")
    ftag = fb.fit("regular", [tagline], 27, 880)
    ImageDraw.Draw(vis).text((cx, 1148), tagline, font=ftag, fill=st.MUTED, anchor="mm")

    labels = (["本地解析", "无遥测", "Markdown 导出"] if zh
              else ["LOCAL PARSE", "NO TELEMETRY", "MARKDOWN EXPORT"])
    widths = ([156, 138, 198] if zh else [176, 212, 268])
    gap = 16
    total = sum(widths) + gap * (len(widths) - 1)
    x = (W - total) / 2
    for text, cw in zip(labels, widths):
        st.draw_chip(vis, x, 1212, cw, 54, text, fb, 18 if zh else 14,
                     fg=st.MUTED, bg=(24, 32, 43), border=(49, 62, 78),
                     mono=not zh)
        x += cw + gap

    ImageDraw.Draw(vis).text((936, 692), "v1.3.0", font=fb.f("mono", 16),
                             fill=st.FAINT, anchor="ra")

    reveal_visual(layer, vis, local)
    draw_kicker(layer, scene["kicker"], local, fb, st.ACCENT)
    draw_headline(layer, scene["headline"], local, fb, 116)
    st.draw_sub(layer, fb, scene["sub"].split("\n"), local, st.ACCENT)
    return layer


def draw_scene_s3(local: float, fb: st.FontBook, scene: dict) -> Image.Image:
    layer = scene_base()
    vis = scene_base()
    zh = fb.lang == "zh"

    st.draw_window(vis, (84, 690, 996, 1350), fb,
                   "Codex 聊天" if zh else "Codex Chat",
                   "LIVE")
    st.draw_activity_bar(vis, (85, 747, 139, 1348))
    rounded_cover = (26, 34, 46)
    st.rounded(vis, (140, 747, 995, 815), 0, fill=rounded_cover)
    ImageDraw.Draw(vis).line((140, 815, 995, 815), fill=(39, 50, 65), width=1)
    ImageDraw.Draw(vis).text((164, 780), "历史会话" if zh else "SESSIONS",
                             font=fb.f("bold", 22), fill=st.TEXT, anchor="lm")
    st.draw_search(vis, 902, 780, 9, st.MUTED, 2)
    ImageDraw.Draw(vis).line((886, 772, 886, 789), fill=(58, 71, 88), width=1)
    st.rounded(vis, (924, 766, 948, 790), 5, outline=st.MUTED, width=2)
    ImageDraw.Draw(vis).line((930, 778, 942, 778), fill=st.MUTED, width=2)
    ImageDraw.Draw(vis).line((936, 772, 936, 784), fill=st.MUTED, width=2)

    groups_zh = [
        ("今天", [
            ("修复登录跳转", "demo-app · 10:42 · 18 条"),
            ("整理发布脚本", "codex-chat-history · 09:18 · 42 条"),
            ("排查类型错误", "codex-chat-history · 08:03 · 27 条"),
        ]),
        ("昨天", [
            ("重构导出模块", "demo-app · 21:40 · 31 条"),
            ("给面板加搜索", "demo-app · 16:22 · 12 条"),
        ]),
        ("11月18日", [
            ("初始化项目", "demo-app · 11:05 · 8 条"),
        ]),
    ]
    groups_en = [
        ("TODAY", [
            ("Fix login redirect", "demo-app · 10:42 · 18 msgs"),
            ("Prepare release", "codex-chat-history · 09:18 · 42 msgs"),
            ("Fix type errors", "codex-chat-history · 08:03 · 27 msgs"),
        ]),
        ("YESTERDAY", [
            ("Refactor export", "demo-app · 21:40 · 31 msgs"),
            ("Add panel search", "demo-app · 16:22 · 12 msgs"),
        ]),
        ("NOV 18", [
            ("Initial commit", "demo-app · 11:05 · 8 msgs"),
        ]),
    ]
    groups = groups_zh if zh else groups_en

    selected = 1 if local < 1.65 else 2
    row_index = 0
    y = 836
    for gi, (label, rows) in enumerate(groups):
        p_label = st.reveal(local, 0.12 + gi * 0.18, 0.45)
        ImageDraw.Draw(vis).text((164, y), label,
                                 font=fb.f("bold", 18),
                                 fill=st.mix(st.BG, st.ACCENT if gi == 0 else st.MUTED, p_label),
                                 anchor="lm")
        y += 30
        for title, meta in rows:
            p = st.reveal(local, 0.18 + row_index * 0.10, 0.45)
            if p > 0:
                row_y = y + int((1 - p) * 14)
                is_sel = row_index == selected
                if is_sel:
                    st.rounded(vis, (148, row_y, 980, row_y + 56), 9,
                               fill=(20, 48, 80), outline=(39, 91, 143))
                    st.rounded(vis, (148, row_y + 7, 153, row_y + 49), 2, fill=st.ACCENT)
                else:
                    st.rounded(vis, (148, row_y, 980, row_y + 56), 9,
                               fill=st.mix(st.BG, (23, 30, 41), p))
                ImageDraw.Draw(vis).text((172, row_y + 18), title,
                                         font=fb.fit("bold", [title], 22, 590),
                                         fill=st.mix(st.BG, st.TEXT, p if not is_sel else 1),
                                         anchor="lm")
                ImageDraw.Draw(vis).text((172, row_y + 39), meta,
                                         font=fb.f("mono" if not zh else "regular", 13),
                                         fill=st.mix(st.BG, st.MUTED, p), anchor="lm")
                ImageDraw.Draw(vis).text((962, row_y + 28), "›",
                                         font=fb.f("mono", 24),
                                         fill=st.mix(st.BG, st.ACCENT if is_sel else st.FAINT, p),
                                         anchor="rm")
            y += 60
            row_index += 1
        y += 22

    reveal_visual(layer, vis, local)
    draw_kicker(layer, scene["kicker"], local, fb, st.ACCENT)
    draw_headline(layer, scene["headline"], local, fb)
    st.draw_sub(layer, fb, scene["sub"].split("\n"), local, st.ACCENT)
    return layer


def draw_scene_s4(local: float, fb: st.FontBook, scene: dict) -> Image.Image:
    layer = scene_base()
    vis = scene_base()
    zh = fb.lang == "zh"

    st.draw_window(vis, (84, 680, 996, 1360), fb,
                   "Codex · 修复登录跳转" if zh else "Codex · Fix login redirect",
                   "已还原" if zh else "RESTORED")

    p1 = st.reveal(local, 0.12, 0.45)
    if p1 > 0:
        st.rounded(vis, (548, 760, 956, 846), 18, fill=st.mix(st.BG, (0, 92, 162), p1))
        text = "登录后总是跳回首页" if zh else "Login keeps bouncing home"
        ImageDraw.Draw(vis).text((570, 803), text,
                                 font=fb.fit("regular", [text], 21, 366),
                                 fill=st.mix(st.BG, (238, 246, 255), p1), anchor="lm")

    p2 = st.reveal(local, 0.36, 0.5)
    if p2 > 0:
        st.rounded(vis, (118, 874, 870, 1006), 18,
                   fill=st.mix(st.BG, (27, 36, 50), p2), outline=(45, 58, 75))
        lines = (["找到问题了：回跳地址没有带 locale。", "已经改好，并补了一条回归测试。"] if zh
                 else ["Found it: the redirect dropped the locale.", "Fixed it and added a regression test."])
        f = fb.fit("regular", lines, 21, 714)
        st.draw_lines(vis, (140, 906), lines, f,
                      st.mix(st.BG, st.TEXT, p2), spacing=8)

    p3 = st.reveal(local, 0.78, 0.45)
    if p3 > 0:
        st.rounded(vis, (118, 1028, 870, 1078), 12,
                   fill=st.mix(st.BG, (24, 31, 43), p3), outline=(44, 56, 72))
        st.draw_chevron(vis, 146, 1053, 8, st.mix(st.BG, st.MUTED, p3), "right", 2)
        ImageDraw.Draw(vis).text((168, 1054),
                                 "思考过程 · 12 秒" if zh else "Reasoning · 12 s",
                                 font=fb.f("bold", 18),
                                 fill=st.mix(st.BG, st.THINK, p3), anchor="lm")
        ImageDraw.Draw(vis).text((846, 1054), "已折叠" if zh else "folded",
                                 font=fb.f("regular" if zh else "mono", 13),
                                 fill=st.mix(st.BG, st.FAINT, p3), anchor="rm")

    p4 = st.reveal(local, 1.12, 0.45)
    if p4 > 0:
        st.rounded(vis, (118, 1094, 870, 1144), 12,
                   fill=st.mix(st.BG, (22, 34, 37), p4), outline=(40, 64, 61))
        st.draw_chevron(vis, 146, 1119, 8, st.mix(st.BG, st.TOOL, p4),
                        "down" if local > 1.9 else "right", 2)
        ImageDraw.Draw(vis).text((168, 1120),
                                 "工具调用 · npm test" if zh else "Tool call · npm test",
                                 font=fb.f("bold", 18),
                                 fill=st.mix(st.BG, st.TOOL, p4), anchor="lm")
        ImageDraw.Draw(vis).text((846, 1120), "24 passed",
                                 font=fb.f("mono", 14),
                                 fill=st.mix(st.BG, st.TOOL, p4), anchor="rm")

    p5 = st.reveal(local, 1.92, 0.5)
    if p5 > 0:
        bottom = 1160 + int(96 * st.ease_out(p5))
        st.rounded(vis, (140, 1156, 848, bottom), 10,
                   fill=st.mix(st.BG, (10, 16, 23), p5), outline=(38, 55, 59))
        rows = (["✓ auth/redirect.test.ts (3)", "✓ auth/session.test.ts (5)",
                 "24 passed in 1.8s"] if zh else
                ["✓ auth/redirect.test.ts (3)", "✓ auth/session.test.ts (5)",
                 "24 passed in 1.8s"])
        y = 1174
        for i, row in enumerate(rows):
            if bottom > y + 18:
                ImageDraw.Draw(vis).text((160, y), row, font=fb.f("mono", 16),
                                         fill=st.mix(st.BG, st.TOOL if i < 2 else st.MUTED, p5))
            y += 27

    p6 = st.reveal(local, 2.35, 0.4)
    if p6 > 0:
        st.rounded(vis, (118, 1278, 432, 1322), 12,
                   fill=(21, 29, 40), outline=(46, 59, 76))
        st.draw_file_icon(vis, 136, 1290, st.ACCENT, 20)
        ImageDraw.Draw(vis).text((166, 1300), "src/auth/redirect.ts",
                                 font=fb.f("mono", 14),
                                 fill=st.mix(st.BG, st.TEXT, p6), anchor="lm")
        st.rounded(vis, (628, 1278, 870, 1322), 12,
                   fill=st.mix(st.BG, (0, 92, 162), p6))
        ImageDraw.Draw(vis).text((749, 1300),
                                 "导出 Markdown" if zh else "Export Markdown",
                                 font=fb.f("bold", 15),
                                 fill=st.mix(st.BG, (240, 248, 255), p6), anchor="mm")

    reveal_visual(layer, vis, local)
    draw_kicker(layer, scene["kicker"], local, fb, st.ACCENT)
    draw_headline(layer, scene["headline"], local, fb)
    st.draw_sub(layer, fb, scene["sub"].split("\n"), local, st.ACCENT)
    return layer


def draw_scene_s5(local: float, fb: st.FontBook, scene: dict) -> Image.Image:
    layer = scene_base()
    vis = scene_base()
    zh = fb.lang == "zh"
    query = "登录跳转" if zh else "redirect"

    st.card(vis, (84, 700, 996, 1348), radius=30, fill=(15, 20, 29),
            outline=(49, 61, 78), top_glow=True)

    p0 = st.reveal(local, 0.08, 0.4)
    if p0 > 0:
        st.rounded(vis, (116, 736, 964, 812), 16,
                   fill=st.mix(st.BG, (9, 14, 21), p0),
                   outline=st.mix(st.BG, st.ACCENT, p0), width=2)
        st.draw_search(vis, 152, 774, 12, st.mix(st.BG, st.MUTED, p0), 3)
        cut = int(len(query) * st.clamp01((local - 0.35) / 0.7))
        fq = fb.f("regular" if zh else "mono", 25)
        ImageDraw.Draw(vis).text((188, 774), query[:cut], font=fq,
                                 fill=st.mix(st.BG, st.TEXT, p0), anchor="lm")
        if cut < len(query) and int(local * 2.4) % 2 == 0:
            cx = 188 + fq.getlength(query[:cut]) + 3
            ImageDraw.Draw(vis).line((cx, 756, cx, 792), fill=st.ACCENT, width=2)
        ImageDraw.Draw(vis).text((936, 774), "12 条结果" if zh else "12 results",
                                 font=fb.f("bold", 17),
                                 fill=st.mix(st.BG, st.MUTED, p0), anchor="rm")

    results_zh = [
        ("修复登录跳转", "今天 10:42 · demo-app",
         "登录跳转总是跳回首页，redirect 没带 locale"),
        ("重构导出模块", "昨天 21:40 · demo-app",
         "导出 Markdown 时，登录跳转的链接要保留"),
        ("排查类型错误", "11月18日 08:03 · demo-app",
         "登录跳转的 locale 参数改为可选，redirect.ts 同步更新"),
    ]
    results_en = [
        ("Fix login redirect", "Today 10:42 · demo-app",
         "Login kept bouncing home; redirect lost the locale"),
        ("Refactor export", "Yesterday 21:40 · demo-app",
         "Keep redirect links when exporting Markdown"),
        ("Fix type errors", "Nov 18 08:03 · demo-app",
         "redirect.ts now accepts an optional locale"),
    ]
    results = results_zh if zh else results_en
    selected = 0 if local < 1.45 else 1

    for i, (title, meta, snippet) in enumerate(results):
        p = st.reveal(local, 0.72 + i * 0.18, 0.45)
        if p <= 0:
            continue
        y = 846 + i * 160
        is_sel = i == selected
        st.rounded(vis, (116, y, 964, y + 142), 15,
                   fill=st.mix(st.BG, (25, 33, 45), p),
                   outline=st.ACCENT if is_sel else (44, 56, 73),
                   width=2 if is_sel else 1)
        if is_sel:
            st.rounded(vis, (116, y + 12, 121, y + 130), 2, fill=st.ACCENT)
        st.draw_file_icon(vis, 142, y + 18, st.ACCENT, 21)
        ImageDraw.Draw(vis).text((176, y + 18), title,
                                 font=fb.fit("bold", [title], 21, 600),
                                 fill=st.mix(st.BG, st.TEXT, p))
        ImageDraw.Draw(vis).text((936, y + 30), meta,
                                 font=fb.f("regular" if zh else "mono", 12),
                                 fill=st.mix(st.BG, st.FAINT, p), anchor="rm")
        fs = fb.fit("regular" if zh else "mono", [snippet], 17, 760)
        draw_highlight_text(vis, 142, y + 66, snippet, query, fs,
                            st.mix(st.BG, st.MUTED, p),
                            st.mix(st.BG, (26, 58, 92), p),
                            st.mix(st.BG, st.ACCENT_SOFT, p))
        ImageDraw.Draw(vis).text((142, y + 105),
                                 "Codex · 会话" if zh else "Codex · session",
                                 font=fb.f("regular" if zh else "mono", 12),
                                 fill=st.mix(st.BG, st.FAINT, p))
        if is_sel:
            st.draw_chip(vis, 842, y + 98, 100, 30,
                         "打开" if zh else "open", fb, 13,
                         fg=st.ACCENT_SOFT, bg=(20, 43, 67), border=(38, 78, 112))

    p = st.reveal(local, 2.0, 0.4)
    if p > 0:
        ImageDraw.Draw(vis).text((540, 1380),
                                 "Ctrl+F 搜索全部会话" if zh else "Ctrl+F to search every session",
                                 font=fb.f("regular" if zh else "mono", 17),
                                 fill=st.mix(st.BG, st.FAINT, p), anchor="mm")

    reveal_visual(layer, vis, local)
    draw_kicker(layer, scene["kicker"], local, fb, st.ACCENT)
    draw_headline(layer, scene["headline"], local, fb)
    st.draw_sub(layer, fb, scene["sub"].split("\n"), local, st.ACCENT)
    return layer


def draw_scene_s6_accounts(local: float, fb: st.FontBook,
                           scene: dict) -> Image.Image:
    layer = scene_base()
    vis = scene_base()
    zh = fb.lang == "zh"
    selected = 0 if local < 1.7 else 1
    switched = local >= 1.7

    st.card(vis, (110, 716, 970, 1284), radius=30, fill=(16, 21, 30),
            outline=(49, 61, 78), top_glow=True)
    for i, col in enumerate(((248, 109, 109), (255, 189, 96), (82, 201, 128))):
        st.circle(vis, (134 + i * 21, 738, 146 + i * 21, 750), fill=col)
    ImageDraw.Draw(vis).text((218, 744), "Codex · 账号" if zh else "Codex · accounts",
                             font=fb.f("bold" if zh else "regular", 20),
                             fill=st.TEXT, anchor="lm")
    st.draw_lock(vis, 822, 744, st.MUTED, 0.68)
    ImageDraw.Draw(vis).text((840, 744), "SecretStorage",
                             font=fb.f("mono", 13), fill=st.FAINT, anchor="lm")
    ImageDraw.Draw(vis).line((110, 770, 970, 770), fill=(39, 50, 65), width=1)

    ImageDraw.Draw(vis).text((140, 796),
                             "已保存 2 个账号" if zh else "2 accounts saved",
                             font=fb.f("regular" if zh else "mono", 15),
                             fill=st.MUTED, anchor="lm")
    ImageDraw.Draw(vis).text((940, 796),
                             "切换后重载窗口" if zh else "reload after switching",
                             font=fb.f("regular" if zh else "mono", 13),
                             fill=st.FAINT, anchor="rm")

    accounts = ([
        ("P", "个人账号", "me@example.com"),
        ("W", "工作账号", "work@example.com"),
    ] if zh else [
        ("P", "Personal", "me@example.com"),
        ("W", "Work", "work@example.com"),
    ])
    for i, (glyph, name, email) in enumerate(accounts):
        p = st.reveal(local, 0.14 + i * 0.18, 0.45)
        if p <= 0:
            continue
        y = 824 + i * 92
        is_sel = i == selected
        fill = st.mix(st.BG, (20, 48, 80) if is_sel else (24, 31, 43), p)
        outline = st.mix(st.BG, (39, 91, 143) if is_sel else (46, 58, 74), p)
        st.rounded(vis, (140, y, 940, y + 82), 14, fill=fill, outline=outline,
                   width=2 if is_sel else 1)
        if is_sel:
            st.rounded(vis, (140, y + 9, 145, y + 73), 2, fill=st.ACCENT)
        st.circle(vis, (162, y + 19, 216, y + 73),
                  fill=st.mix(st.BG, (15, 52, 88), p),
                  outline=st.mix(st.BG, st.ACCENT if is_sel else st.LINE, p),
                  width=2)
        ImageDraw.Draw(vis).text((189, y + 46), glyph,
                                 font=fb.f("bold", 20),
                                 fill=st.mix(st.BG, st.ACCENT_SOFT if is_sel else st.TEXT, p),
                                 anchor="mm")
        ImageDraw.Draw(vis).text((232, y + 26), name,
                                 font=fb.f("bold", 21),
                                 fill=st.mix(st.BG, st.TEXT, p), anchor="lm")
        ImageDraw.Draw(vis).text((232, y + 54), email,
                                 font=fb.f("mono", 14),
                                 fill=st.mix(st.BG, st.MUTED, p), anchor="lm")

        badge = ("当前" if is_sel else "已保存") if zh else ("Current" if is_sel else "Saved")
        bf = fb.f("bold", 14 if zh else 12)
        bw = bf.getlength(badge) + 36
        bx = 920 - bw
        st.rounded(vis, (bx, y + 26, 920, y + 56), 15,
                   fill=st.mix(st.BG, (20, 44, 40) if is_sel else (29, 37, 49), p),
                   outline=st.mix(st.BG, (35, 82, 72) if is_sel else (47, 59, 75), p))
        ImageDraw.Draw(vis).text((bx + bw / 2, y + 42), badge, font=bf,
                                 fill=st.mix(st.BG, st.TOOL if is_sel else st.MUTED, p),
                                 anchor="mm")

    p_add = st.reveal(local, 0.55, 0.45)
    if p_add > 0:
        st.rounded(vis, (140, 1016, 940, 1078), 12,
                   fill=st.mix(st.BG, (20, 27, 37), p_add),
                   outline=st.mix(st.BG, (44, 56, 72), p_add))
        plus_fill = st.mix(st.BG, st.ACCENT, p_add)
        ImageDraw.Draw(vis).line((171, 1047, 185, 1047), fill=plus_fill, width=2)
        ImageDraw.Draw(vis).line((178, 1040, 178, 1054), fill=plus_fill, width=2)
        ImageDraw.Draw(vis).text((202, 1048),
                                 "添加账号（官方网页登录）" if zh
                                 else "Add account (official web login)",
                                 font=fb.f("regular" if zh else "mono", 16),
                                 fill=st.mix(st.BG, st.TEXT, p_add), anchor="lm")
        ImageDraw.Draw(vis).text((920, 1048),
                                 "临时目录" if zh else "temp profile",
                                 font=fb.f("regular" if zh else "mono", 12),
                                 fill=st.mix(st.BG, st.FAINT, p_add), anchor="rm")

    p_note = st.reveal(local, 0.75, 0.45)
    if p_note > 0:
        st.draw_lock(vis, 152, 1112, st.mix(st.BG, st.TOOL, p_note), 0.72)
        ImageDraw.Draw(vis).text((170, 1112),
                                 "凭据加密保存在 VS Code SecretStorage" if zh
                                 else "Credentials encrypted in VS Code SecretStorage",
                                 font=fb.f("regular" if zh else "mono", 14),
                                 fill=st.mix(st.BG, st.MUTED, p_note), anchor="lm")

    st.rounded(vis, (140, 1152, 940, 1212), 12, fill=(11, 17, 25),
               outline=(41, 54, 70))
    st.circle(vis, (162, 1168, 182, 1188), outline=st.ACCENT, width=2)
    ImageDraw.Draw(vis).arc((154, 1180, 190, 1212), start=200, end=340,
                            fill=st.ACCENT, width=2)
    ImageDraw.Draw(vis).text((204, 1182),
                             ("Codex · 工作账号" if selected else "Codex · 个人账号")
                             if zh else
                             ("Codex · Work" if selected else "Codex · Personal"),
                             font=fb.f("bold", 17), fill=st.TEXT, anchor="lm")
    if switched:
        ImageDraw.Draw(vis).text((920, 1182),
                                 "已切换 · 重载窗口生效" if zh
                                 else "Switched · reload to apply",
                                 font=fb.f("regular" if zh else "mono", 13),
                                 fill=st.TOOL, anchor="rm")
    else:
        ImageDraw.Draw(vis).text((920, 1182),
                                 "点击切换" if zh else "click to switch",
                                 font=fb.f("regular" if zh else "mono", 13),
                                 fill=st.FAINT, anchor="rm")

    labels = (["加密备份", "不写设置", "重载生效"] if zh
              else ["ENCRYPTED", "NOT IN SETTINGS", "RELOAD TO APPLY"])
    widths = ([158, 158, 176] if zh else [176, 234, 250])
    gap = 14
    total = sum(widths) + gap * (len(widths) - 1)
    x = (W - total) / 2
    for i, (text, cw) in enumerate(zip(labels, widths)):
        p = st.reveal(local, 1.05 + i * 0.10, 0.4)
        if p > 0:
            st.draw_chip(vis, x, 1302, cw, 52, text, fb, 17 if zh else 13,
                         fg=st.mix(st.BG, st.TEXT, p),
                         bg=st.mix(st.BG, (24, 33, 44), p),
                         border=st.mix(st.BG, (48, 62, 78), p),
                         dot=st.mix(st.BG, st.TOOL, p), mono=not zh)
        x += cw + gap

    reveal_visual(layer, vis, local)
    draw_kicker(layer, scene["kicker"], local, fb, st.ACCENT)
    draw_headline(layer, scene["headline"], local, fb)
    st.draw_sub(layer, fb, scene["sub"].split("\n"), local, st.ACCENT)
    return layer


def draw_scene_s7(local: float, fb: st.FontBook, scene: dict) -> Image.Image:
    layer = scene_base()
    vis = scene_base()
    zh = fb.lang == "zh"

    st.card(vis, (84, 700, 600, 1232), radius=28, fill=(18, 25, 35),
            outline=(48, 61, 78), top_glow=True)
    ring_p = st.ease_out(local / 0.9)
    for i in range(3):
        r = 128 + i * 22 + 3 * math.sin(local * 1.5 - i * 0.5)
        st.circle(vis, (342 - r, 884 - r, 342 + r, 884 + r),
                  outline=st.mix(st.BG, st.ACCENT, (0.15 - i * 0.04) * ring_p), width=2)
    st.draw_shield(vis, 342, 884, 214, 258, st.ACCENT_DARK, st.ACCENT, 5)
    st.draw_check(vis, 342, 882, 34, st.TOOL)

    ImageDraw.Draw(vis).text((342, 700 + 34), "LOCAL ONLY", font=fb.f("mono", 15),
                             fill=st.ACCENT_SOFT, anchor="mm")
    ImageDraw.Draw(vis).text((342, 1060), "0 B", font=fb.f("mono", 66),
                             fill=st.TEXT, anchor="mm")
    ImageDraw.Draw(vis).text((342, 1112),
                             "上传的会话数据" if zh else "session data uploaded",
                             font=fb.f("regular", 17), fill=st.MUTED, anchor="mm")
    rows = (["本机解析", "无遥测", "不上传"] if zh else ["LOCAL PARSE", "NO TELEMETRY", "NO UPLOAD"])
    for i, text in enumerate(rows):
        y = 1152 + i * 26
        st.draw_check(vis, 128, y + 8, 8, st.TOOL)
        ImageDraw.Draw(vis).text((146, y + 9), text,
                                 font=fb.f("mono" if not zh else "regular", 15),
                                 fill=st.MUTED, anchor="lm")

    st.card(vis, (620, 700, 996, 1232), radius=28, fill=(18, 25, 35),
            outline=(48, 61, 78), top_glow=True)
    md_lines = ([
        ("h1", "# 修复登录跳转"),
        ("h2", "## 用户"),
        ("p", "登录后总是跳回首页"),
        ("h2", "## Codex"),
        ("p", "已更新 redirect.ts"),
        ("code", "24 passed in 1.8s"),
    ] if zh else [
        ("h1", "# Fix login redirect"),
        ("h2", "## User"),
        ("p", "Login bounces home"),
        ("h2", "## Codex"),
        ("p", "Updated redirect.ts"),
        ("code", "24 passed in 1.8s"),
    ])
    st.draw_markdown(vis, (644, 726, 972, 1192), fb,
                     "auth-fix.md", md_lines, st.ACCENT)
    st.rounded(vis, (664, 1150, 952, 1192), 12, fill=st.ACCENT)
    ImageDraw.Draw(vis).text((808, 1171),
                             "下载 Markdown" if zh else "Download Markdown",
                             font=fb.f("bold", 15), fill=st.INK, anchor="mm")

    pills = (["本地解析", "无遥测", "不上传", "加密账号"] if zh
             else ["LOCAL", "NO TELEMETRY", "NO UPLOAD", "ENCRYPTED"])
    widths = ([204, 172, 172, 204] if zh else [140, 214, 194, 190])
    gap = 12
    total = sum(widths) + gap * (len(widths) - 1)
    x = (W - total) / 2
    for i, (text, cw) in enumerate(zip(pills, widths)):
        p = st.reveal(local, 1.05 + i * 0.10, 0.4)
        if p > 0:
            st.draw_chip(vis, x, 1266, cw, 54, text, fb, 17 if zh else 13,
                         fg=st.mix(st.BG, st.TEXT, p),
                         bg=st.mix(st.BG, (24, 33, 44), p),
                         border=st.mix(st.BG, (48, 62, 78), p),
                         dot=st.mix(st.BG, st.TOOL, p), mono=not zh)
        x += cw + gap

    reveal_visual(layer, vis, local)
    draw_kicker(layer, scene["kicker"], local, fb, st.ACCENT)
    draw_headline(layer, scene["headline"], local, fb)
    st.draw_sub(layer, fb, scene["sub"].split("\n"), local, st.ACCENT)
    return layer


def draw_scene_s8(local: float, fb: st.FontBook, scene: dict) -> Image.Image:
    layer = scene_base()
    vis = scene_base()
    zh = fb.lang == "zh"
    cx, cy = 540, 842

    pulse = (math.sin(local * 2.2) + 1) / 2
    for i in range(3):
        r = 108 + i * 18 + pulse * 8
        st.circle(vis, (cx - r, cy - r, cx + r, cy + r),
                  outline=st.mix(st.BG, st.ACCENT, 0.18 - i * 0.045), width=2)
    vis.alpha_composite(st.make_icon(176), (cx - 88, cy - 88))

    ImageDraw.Draw(vis).text((cx, 988), "Codex History Lens",
                             font=fb.fit("bold", ["Codex History Lens"], 58, 900),
                             fill=st.TEXT, anchor="mm")
    tagline = "在 VS Code 里，把历史留在手边" if zh else "Keep your Codex history within reach"
    ImageDraw.Draw(vis).text((cx, 1044), tagline,
                             font=fb.fit("regular", [tagline], 23, 880),
                             fill=st.MUTED, anchor="mm")

    st.rounded(vis, (156, 1094, 924, 1190), 24, fill=st.ACCENT_DEEP)
    cta = "在 VS Code 扩展商店安装" if zh else "Install from VS Code Marketplace"
    ImageDraw.Draw(vis).text((520, 1142), cta,
                             font=fb.fit("bold", [cta], 30, 590),
                             fill=(240, 248, 255), anchor="mm")
    st.draw_arrow(vis, 830, 1142, (240, 248, 255), 1.15)

    ImageDraw.Draw(vis).text((cx, 1228), "hkle.codex-history-lens-hkle",
                             font=fb.f("mono", 21), fill=st.MUTED, anchor="mm")

    labels = (["免费", "开源 MIT", "本地优先"] if zh
              else ["FREE", "OPEN SOURCE", "LOCAL FIRST"])
    widths = ([126, 170, 170] if zh else [130, 210, 200])
    gap = 16
    total = sum(widths) + gap * (len(widths) - 1)
    x = (W - total) / 2
    for text, cw in zip(labels, widths):
        st.draw_chip(vis, x, 1276, cw, 52, text, fb, 17 if zh else 14,
                     fg=st.TEXT, bg=(24, 32, 43), border=(48, 61, 78),
                     mono=not zh)
        x += cw + gap
    ImageDraw.Draw(vis).text((cx, 1364), "marketplace.visualstudio.com",
                             font=fb.f("mono", 16), fill=st.FAINT, anchor="mm")

    reveal_visual(layer, vis, local)
    draw_kicker(layer, scene["kicker"], local, fb, st.ACCENT)
    draw_headline(layer, scene["headline"], local, fb)
    st.draw_sub(layer, fb, scene["sub"].split("\n"), local, st.ACCENT)
    return layer


SCENE_FN = {
    "s1": draw_scene_s1,
    "s2": draw_scene_s2,
    "s3": draw_scene_s3,
    "s4": draw_scene_s4,
    "s5": draw_scene_s5,
    "s6": draw_scene_s6_accounts,
    "s7": draw_scene_s7,
    "s8": draw_scene_s8,
}


def render_scene(scene: dict, local: float, fb: st.FontBook) -> Image.Image:
    local = max(0.0, min(local, scene["dur"]))
    return SCENE_FN[scene["id"]](local, fb, scene)


def render_frame(t: float, tl: dict, fb: st.FontBook) -> Image.Image:
    base = st.make_background().copy().convert("RGBA")
    scenes = tl["scenes"]
    idx = 0
    for i, scene in enumerate(scenes):
        if t >= scene["start"]:
            idx = i
    scene = scenes[idx]
    local = t - scene["start"]
    if idx == 0:
        local += 0.55
    fade = 0.30
    if idx > 0 and local < fade:
        prev = scenes[idx - 1]
        base.alpha_composite(render_scene(prev, prev["dur"] - 0.01, fb))
        cur = st.with_alpha(render_scene(scene, local, fb), st.ease_in_out(local / fade))
    else:
        cur = render_scene(scene, local, fb)
    base.alpha_composite(cur)

    overlay = scene_base()
    st.draw_header(overlay, fb)
    st.draw_progress(overlay, idx, len(scenes))
    base.alpha_composite(overlay)
    return base.convert("RGB")


def load_timeline(lang: str) -> dict:
    path = ROOT / f"timeline.{lang}.json"
    tl = json.loads(path.read_text(encoding="utf-8"))
    if not tl.get("total"):
        raise SystemExit(f"{path.name} has no computed timing; run build_assets.py first")
    return tl


def cover_time(tl: dict) -> float:
    scene = tl["scenes"][1]
    return scene["start"] + 1.55


def save_cover(lang: str, tl: dict, fb: st.FontBook) -> Path:
    out = VIDEO / lang / NAME[lang]["cover"]
    out.parent.mkdir(parents=True, exist_ok=True)
    render_frame(cover_time(tl), tl, fb).save(out, optimize=True)
    return out


def ffmpeg_exe() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def encode(lang: str, tl: dict, fb: st.FontBook) -> Path:
    out = VIDEO / lang / NAME[lang]["video"]
    out.parent.mkdir(parents=True, exist_ok=True)
    mix = ROOT / "build" / lang / "mix.wav"
    if not mix.exists():
        raise SystemExit(f"missing mix: {mix}; run build_assets.py first")
    total = float(tl["total"])
    fade_start = max(0.0, total - 1.3)
    cmd = [
        ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "warning",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-i", str(mix),
        "-af", f"loudnorm=I=-14.2:TP=-1.6:LRA=11,afade=t=out:st={fade_start:.3f}:d=1.3",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
        "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
        "-maxrate", "9M", "-bufsize", "18M",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart", "-shortest",
        str(out),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    frames = int(round(total * FPS))
    try:
        for i in range(frames):
            frame = render_frame(i / FPS, tl, fb)
            proc.stdin.write(frame.tobytes())
            if i % 150 == 0:
                print(f"[{lang}] frame {i}/{frames}", flush=True)
    finally:
        if proc.stdin:
            proc.stdin.close()
    code = proc.wait()
    if code != 0:
        raise SystemExit(f"ffmpeg failed for {lang}: {code}")
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=["zh", "en", "all"], default="all")
    parser.add_argument("--still", type=float, help="render one frame at this timestamp")
    parser.add_argument("--cover-only", action="store_true")
    args = parser.parse_args()
    langs = ["zh", "en"] if args.lang == "all" else [args.lang]
    for lang in langs:
        tl = load_timeline(lang)
        fb = st.FontBook(lang)
        if args.still is not None:
            out = ROOT / "build" / lang / f"still-{args.still:.2f}.png"
            out.parent.mkdir(parents=True, exist_ok=True)
            render_frame(args.still, tl, fb).save(out)
            print(out)
            continue
        if not args.cover_only:
            print(encode(lang, tl, fb))
        print(save_cover(lang, tl, fb))


if __name__ == "__main__":
    main()
