from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
FPS = 30

BG = (10, 14, 21)
BG_TOP = (7, 10, 16)
BG_BOTTOM = (10, 21, 33)
SURFACE = (18, 24, 34)
CARD = (24, 32, 44)
CARD_HOVER = (33, 43, 58)
LINE = (42, 54, 70)
TEXT = (232, 238, 247)
MUTED = (146, 162, 183)
FAINT = (95, 110, 129)
ACCENT = (77, 170, 252)
ACCENT_DEEP = (0, 120, 212)
ACCENT_SOFT = (126, 195, 255)
ACCENT_DARK = (12, 42, 72)
THINK = (197, 134, 192)
TOOL = (78, 201, 176)
WARM = (255, 184, 92)
DANGER = (248, 109, 109)
INK = (7, 17, 29)

FONT_DIR = Path(r"C:\Windows\Fonts")
FONT_FILES = {
    "zh_bold": FONT_DIR / "msyhbd.ttc",
    "zh_regular": FONT_DIR / "msyh.ttc",
    "en_bold": FONT_DIR / "segoeuib.ttf",
    "en_regular": FONT_DIR / "segoeui.ttf",
    "mono": FONT_DIR / "CascadiaMono.ttf",
}


class FontBook:
    def __init__(self, lang: str):
        self.lang = lang
        self.bold = FONT_FILES["zh_bold" if lang == "zh" else "en_bold"]
        self.regular = FONT_FILES["zh_regular" if lang == "zh" else "en_regular"]
        for path in (self.bold, self.regular, FONT_FILES["mono"]):
            if not path.exists():
                raise SystemExit(f"font missing: {path}")

    @lru_cache(maxsize=512)
    def f(self, kind: str, size: int) -> ImageFont.FreeTypeFont:
        path = FONT_FILES["mono"] if kind == "mono" else (
            self.bold if kind == "bold" else self.regular
        )
        return ImageFont.truetype(str(path), size, index=0)

    def fit(self, kind: str, lines: list[str], max_size: int, max_width: int,
            min_size: int = 16) -> ImageFont.FreeTypeFont:
        size = max_size
        while size > min_size:
            f = self.f(kind, size)
            if max((f.getlength(line) for line in lines), default=0) <= max_width:
                return f
            size -= 2
        return self.f(kind, min_size)


def clamp01(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def ease_out(t: float) -> float:
    t = clamp01(t)
    return 1 - (1 - t) ** 3


def ease_in_out(t: float) -> float:
    t = clamp01(t)
    return 3 * t * t - 2 * t * t * t


def smooth(t: float) -> float:
    t = clamp01(t)
    return t * t * (3 - 2 * t)


def reveal(local: float, delay: float = 0.0, dur: float = 0.5) -> float:
    return ease_out((local - delay) / dur)


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    t = clamp01(t)
    return (
        int(round(a[0] + (b[0] - a[0]) * t)),
        int(round(a[1] + (b[1] - a[1]) * t)),
        int(round(a[2] + (b[2] - a[2]) * t)),
    )


def text_w(font: ImageFont.FreeTypeFont, s: str) -> float:
    return font.getlength(s)


def line_h(font: ImageFont.FreeTypeFont) -> int:
    return int(font.size * 1.2)


def draw_lines(layer: Image.Image, xy: tuple[int, int], lines: list[str],
               font: ImageFont.FreeTypeFont, fill: tuple[int, int, int],
               spacing: int = 10, align: str = "left",
               width: int | None = None) -> int:
    draw = ImageDraw.Draw(layer)
    x, y = xy
    step = line_h(font) + spacing
    for i, line in enumerate(lines):
        if align == "center":
            tx = x + ((width or 0) - font.getlength(line)) / 2
        elif align == "right":
            tx = x + (width or 0) - font.getlength(line)
        else:
            tx = x
        draw.text((tx, y + i * step), line, font=font, fill=fill)
    return y + len(lines) * step - spacing


def tracked_width(font: ImageFont.FreeTypeFont, s: str, tracking: float) -> float:
    return sum(font.getlength(ch) for ch in s) + max(0, len(s) - 1) * tracking


def draw_tracked(layer: Image.Image, xy: tuple[int, int], s: str,
                 font: ImageFont.FreeTypeFont, fill: tuple[int, int, int],
                 tracking: float = 2.0, align: str = "left",
                 width: int | None = None) -> None:
    draw = ImageDraw.Draw(layer)
    x, y = xy
    total = tracked_width(font, s, tracking)
    if align == "center":
        x += ((width or 0) - total) / 2
    elif align == "right":
        x += (width or 0) - total
    for ch in s:
        draw.text((x, y), ch, font=font, fill=fill)
        x += font.getlength(ch) + tracking


def rounded(layer: Image.Image, box: tuple[float, float, float, float], radius: int,
            fill=None, outline=None, width: int = 1) -> None:
    ImageDraw.Draw(layer).rounded_rectangle(box, radius=radius, fill=fill,
                                            outline=outline, width=width)


def card(layer: Image.Image, box: tuple[float, float, float, float], radius: int = 28,
         fill=CARD, outline=LINE, top_glow: bool = False) -> None:
    x1, y1, x2, y2 = box
    rounded(layer, (x1, y1 + 10, x2, y2 + 10), radius, fill=(4, 7, 11))
    rounded(layer, box, radius, fill=fill, outline=outline, width=1)
    if top_glow:
        ImageDraw.Draw(layer).line((x1 + radius, y1 + 1, x2 - radius, y1 + 1),
                                   fill=mix(fill, ACCENT, 0.20), width=1)


def circle(layer: Image.Image, box: tuple[float, float, float, float], fill=None,
           outline=None, width: int = 1) -> None:
    ImageDraw.Draw(layer).ellipse(box, fill=fill, outline=outline, width=width)


def with_alpha(layer: Image.Image, alpha: float) -> Image.Image:
    alpha = clamp01(alpha)
    if alpha >= 0.999:
        return layer
    out = layer.copy()
    a = out.getchannel("A").point(lambda v: int(v * alpha))
    out.putalpha(a)
    return out


def draw_arrow(layer: Image.Image, x: float, y: float, color=INK,
               scale: float = 1.0) -> None:
    draw = ImageDraw.Draw(layer)
    draw.line((x, y, x + 26 * scale, y), fill=color, width=max(2, int(3 * scale)))
    draw.line((x + 16 * scale, y - 8 * scale, x + 26 * scale, y,
               x + 16 * scale, y + 8 * scale), fill=color,
              width=max(2, int(3 * scale)), joint="curve")


def draw_chevron(layer: Image.Image, x: float, y: float, size: float = 10,
                 color=MUTED, direction: str = "right", width: int = 2) -> None:
    draw = ImageDraw.Draw(layer)
    if direction == "right":
        pts = [(x - size * 0.35, y - size), (x + size * 0.35, y),
               (x - size * 0.35, y + size)]
    elif direction == "down":
        pts = [(x - size, y - size * 0.35), (x, y + size * 0.35),
               (x + size, y - size * 0.35)]
    else:
        pts = [(x + size * 0.35, y - size), (x - size * 0.35, y),
               (x + size * 0.35, y + size)]
    draw.line(pts, fill=color, width=width, joint="curve")


def draw_check(layer: Image.Image, cx: float, cy: float, r: float = 14,
               color=TOOL, ink=INK) -> None:
    draw = ImageDraw.Draw(layer)
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)
    draw.line((cx - r * 0.42, cy + r * 0.02, cx - r * 0.10, cy + r * 0.34,
               cx + r * 0.48, cy - r * 0.34), fill=ink,
              width=max(2, int(r * 0.28)), joint="curve")


def draw_search(layer: Image.Image, cx: float, cy: float, r: float = 12,
                color=MUTED, width: int = 3) -> None:
    draw = ImageDraw.Draw(layer)
    draw.ellipse((cx - r, cy - r, cx + r * 0.55, cy + r * 0.55),
                 outline=color, width=width)
    draw.line((cx + r * 0.45, cy + r * 0.45, cx + r * 1.25, cy + r * 1.25),
              fill=color, width=width)


def draw_spinner(layer: Image.Image, cx: float, cy: float, r: float,
                 phase: float, color=MUTED) -> None:
    draw = ImageDraw.Draw(layer)
    start = (phase * 300) % 360
    draw.arc((cx - r, cy - r, cx + r, cy + r), start=start, end=start + 260,
             fill=color, width=3)
    draw.arc((cx - r, cy - r, cx + r, cy + r), start=start + 270, end=start + 350,
             fill=mix(color, BG, 0.6), width=3)


def draw_shield(layer: Image.Image, cx: float, cy: float, w: float, h: float,
                fill=ACCENT_DARK, outline=ACCENT, width: int = 5) -> None:
    draw = ImageDraw.Draw(layer)
    pts = [
        (cx, cy - h / 2),
        (cx + w / 2, cy - h * 0.34),
        (cx + w * 0.46, cy + h * 0.14),
        (cx, cy + h / 2),
        (cx - w * 0.46, cy + h * 0.14),
        (cx - w / 2, cy - h * 0.34),
    ]
    draw.polygon(pts, fill=fill, outline=outline)
    draw.line(pts + [pts[0]], fill=outline, width=width, joint="curve")


@lru_cache(maxsize=8)
def make_icon(size: int = 256) -> Image.Image:
    ss = 4
    n = size * ss
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    t = (xx * 0.35 + yy * 0.65) / n
    top = np.array([50, 145, 238], np.float32)
    bottom = np.array([0, 82, 176], np.float32)
    arr = top[None, None, :] * (1 - t[..., None]) + bottom[None, None, :] * t[..., None]
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, n - 1, n - 1),
                                           radius=int(n * 0.225), fill=255)
    img.putalpha(mask)

    draw = ImageDraw.Draw(img)
    white = (245, 250, 255)
    lw = max(2, int(n * 0.052))
    bubble = (n * 0.185, n * 0.235, n * 0.815, n * 0.665)
    draw.rounded_rectangle(bubble, radius=int(n * 0.085), outline=white, width=lw)
    draw.polygon([(n * 0.285, n * 0.645), (n * 0.285, n * 0.815),
                  (n * 0.455, n * 0.655)], fill=white)
    draw.line((n * 0.335, n * 0.365, n * 0.430, n * 0.445,
               n * 0.335, n * 0.525), fill=white, width=lw, joint="curve")
    draw.line((n * 0.505, n * 0.525, n * 0.640, n * 0.525), fill=white, width=lw)
    return img.resize((size, size), Image.Resampling.LANCZOS)


@lru_cache(maxsize=4)
def make_background(w: int = W, h: int = H) -> Image.Image:
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ty = (np.arange(h, dtype=np.float32) / (h - 1))[:, None, None]
    top = np.array(BG_TOP, np.float32)
    bottom = np.array(BG_BOTTOM, np.float32)
    arr = top[None, None, :] * (1 - ty) + bottom[None, None, :] * ty
    arr = np.repeat(arr, w, axis=1)

    def glow(cx, cy, rad, color, amp):
        g = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * rad * rad)))
        return g[..., None] * np.array(color, np.float32) * amp

    arr += glow(w * 0.84, h * 0.12, w * 0.58, (16, 73, 132), 0.30)
    arr += glow(w * 0.10, h * 0.80, w * 0.64, (52, 34, 86), 0.16)
    arr += glow(w * 0.52, h * 0.46, w * 0.50, (12, 48, 76), 0.12)

    grid = ((xx.astype(np.int32) % 72 == 0) | (yy.astype(np.int32) % 72 == 0)).astype(np.float32)
    grid_color = np.array((26, 42, 58), np.float32)
    arr = arr * (1 - grid[..., None] * 0.10) + grid_color[None, None, :] * grid[..., None] * 0.10

    dist = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    vig = np.clip(1.0 - 0.32 * np.maximum(0, dist - 0.44) ** 1.7, 0.60, 1.0)
    arr *= vig[..., None]

    rng = np.random.default_rng(20261124)
    arr += rng.normal(0, 1.7, (h, w, 1))
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def draw_progress(layer: Image.Image, c: int, total: int, accent=ACCENT) -> None:
    x1, x2, y = 84, 996, 280
    gap = 10
    seg = (x2 - x1 - gap * (total - 1)) / total
    for i in range(total):
        bx1 = x1 + i * (seg + gap)
        bx2 = bx1 + seg
        if i < c:
            color = mix(accent, BG, 0.40)
        elif i == c:
            color = accent
        else:
            color = (38, 48, 62)
        rounded(layer, (bx1, y, bx2, y + 4), 2, fill=color)


def draw_header(layer: Image.Image, fb: FontBook, accent=ACCENT) -> None:
    layer.alpha_composite(make_icon(46), (84, 196))
    draw_tracked(layer, (144, 205), "CODEX HISTORY LENS", fb.f("mono", 23),
                 MUTED, tracking=3.0)
    draw_tracked(layer, (996, 205), "LOCAL · NO UPLOAD", fb.f("mono", 19),
                 mix(MUTED, BG, 0.20), tracking=1.4, align="right")
    ImageDraw.Draw(layer).line((84, 262, 996, 262), fill=(32, 43, 57), width=1)


def draw_sub(layer: Image.Image, fb: FontBook, lines: list[str], local: float,
             accent=ACCENT) -> None:
    p = reveal(local, 0.28, 0.55)
    if p <= 0:
        return
    color = mix(BG, (203, 214, 227), p)
    f = fb.fit("regular", lines, 40 if fb.lang == "zh" else 35, 880)
    rounded(layer, (84, 1438, 90, 1536), 3, fill=mix(BG, accent, p))
    draw_lines(layer, (112, 1436), lines, f, color, spacing=8)


def draw_chip(layer: Image.Image, x: float, y: float, w: float, h: float,
              text: str, fb: FontBook, size: int, fg=TEXT, bg=(26, 35, 48),
              border=(54, 68, 86), dot=None, mono: bool = False) -> None:
    rounded(layer, (x, y, x + w, y + h), int(h / 2), fill=bg, outline=border, width=1)
    f = fb.f("mono" if mono else "bold", size)
    dx = x + 22
    if dot is not None:
        ImageDraw.Draw(layer).ellipse((x + 18, y + h / 2 - 5, x + 28, y + h / 2 + 5),
                                      fill=dot)
        dx = x + 40
    ImageDraw.Draw(layer).text((dx, y + h / 2 + 1), text, font=f, fill=fg, anchor="lm")


def draw_window(layer: Image.Image, box: tuple[float, float, float, float],
                fb: FontBook, title: str, badge: str = "") -> None:
    x1, y1, x2, y2 = box
    card(layer, box, radius=30, fill=(16, 21, 30), outline=(48, 61, 78), top_glow=True)
    for i, col in enumerate(((248, 109, 109), (255, 189, 96), (82, 201, 128))):
        circle(layer, (x1 + 28 + i * 22, y1 + 26, x1 + 40 + i * 22, y1 + 38), fill=col)
    ImageDraw.Draw(layer).text((x1 + 112, y1 + 32), title,
                               font=fb.f("bold" if fb.lang == "zh" else "regular", 21),
                               fill=mix(TEXT, BG, 0.06), anchor="lm")
    if badge:
        bf = fb.f("regular" if fb.lang == "zh" else "mono", 16)
        bw = bf.getlength(badge) + 30
        rounded(layer, (x2 - bw - 28, y1 + 15, x2 - 28, y1 + 43), 14,
                fill=(20, 44, 40), outline=(35, 82, 72))
        ImageDraw.Draw(layer).text((x2 - bw / 2 - 28, y1 + 30), badge,
                                   font=bf, fill=TOOL, anchor="mm")
    ImageDraw.Draw(layer).line((x1, y1 + 56, x2, y1 + 56), fill=(39, 50, 65), width=1)


def draw_activity_bar(layer: Image.Image,
                      box: tuple[float, float, float, float]) -> None:
    x1, y1, x2, y2 = box
    rounded(layer, (x1, y1, x2, y2), 0, fill=(12, 17, 24))
    ImageDraw.Draw(layer).line((x2, y1, x2, y2), fill=(32, 43, 57), width=1)
    cx = (x1 + x2) / 2
    items = [("chat", y1 + 46), ("search", y1 + 104), ("folder", y1 + 162),
             ("account", y1 + 220)]
    for kind, cy in items:
        if kind == "chat":
            rounded(layer, (cx - 13, cy - 13, cx + 13, cy + 8), 5,
                    fill=ACCENT,
                    outline=ACCENT)
            ImageDraw.Draw(layer).polygon([(cx - 8, cy + 8), (cx - 3, cy + 16),
                                           (cx - 1, cy + 8)], fill=ACCENT)
        elif kind == "search":
            draw_search(layer, cx - 2, cy - 2, 11, MUTED, 3)
        elif kind == "folder":
            ImageDraw.Draw(layer).rounded_rectangle((cx - 14, cy - 9, cx + 14, cy + 11),
                                                    radius=4, outline=MUTED, width=2)
        else:
            ImageDraw.Draw(layer).ellipse((cx - 9, cy - 12, cx + 9, cy + 6),
                                          outline=MUTED, width=2)
            ImageDraw.Draw(layer).arc((cx - 15, cy + 4, cx + 15, cy + 30),
                                      start=200, end=340, fill=MUTED, width=2)


def draw_file_icon(layer: Image.Image, x: float, y: float, color=ACCENT,
                   size: float = 22) -> None:
    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle((x, y, x + size * 0.72, y + size), radius=3,
                           outline=color, width=2)
    draw.line((x + size * 0.46, y, x + size * 0.72, y + size * 0.26),
              fill=color, width=2)
    draw.line((x + size * 0.16, y + size * 0.55, x + size * 0.56, y + size * 0.55),
              fill=color, width=2)
    draw.line((x + size * 0.16, y + size * 0.74, x + size * 0.46, y + size * 0.74),
              fill=color, width=2)


def draw_markdown(layer: Image.Image, box: tuple[float, float, float, float],
                  fb: FontBook, filename: str, lines: list[tuple[str, str]],
                  accent=ACCENT) -> None:
    x1, y1, x2, y2 = box
    card(layer, box, radius=22, fill=(19, 26, 36), outline=(45, 58, 75))
    draw_file_icon(layer, x1 + 24, y1 + 22, accent, 24)
    ImageDraw.Draw(layer).text((x1 + 60, y1 + 24), filename,
                               font=fb.f("mono", 20), fill=TEXT, anchor="lm")
    ImageDraw.Draw(layer).line((x1, y1 + 62, x2, y1 + 62),
                               fill=(38, 49, 64), width=1)
    y = y1 + 82
    for kind, text in lines:
        has_cjk = any("\u4e00" <= ch <= "\u9fff" for ch in text)
        f = fb.f("regular" if has_cjk and fb.lang == "zh" else "mono", 17)
        color = {"h1": ACCENT_SOFT, "h2": THINK, "p": MUTED, "code": TOOL}.get(kind, MUTED)
        ImageDraw.Draw(layer).text((x1 + 26, y), text, font=f, fill=color)
        y += 30
