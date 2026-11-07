#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""鲸鱼女仆像素精灵表生成器（AI 素材版，office/web/assets/whale.png）

角色立绘由生图模型按用户提供的三视图生成，源文件在 office/tools/preview/ai/：
  front / side / back 三方向定妆，加上 typing / read / drink / wave / lounge /
  cheer / play / sleep / dizzy / think / eat / sit 共 15 张动作立绘。
本脚本只做工程化处理，不画角色：
  抠白底(连通域 floodfill) → 裁内容框 → 硬边缩放 → 统一 24 色调色板量化 →
  1px 深色外轮廓 → 按脚点 y=55 居中到 64x64 帧 → 每行派生 8 帧微动 → 拼表。

布局（每帧 64x64，每行 8 帧，共 20 行 = 160 帧）：
  row 0-3   行走 South / East / West / North（索引与旧版完全兼容）
  row 4-19  动作行，行号见 whale.json / manifest.json 的 whale.acts

用法：
  python office/tools/gen_whale.py             # 生成 whale.png + 两个 json + 预览图
  python office/tools/gen_whale.py --preview  # 只出预览，不动 assets
改完必须跑：node office/tools/bust.mjs && node office/tools/check.mjs

历史：v19 初版是逐像素程序化绘制，效果偏"手工"，已留档为 gen_whale_procedural.py。
"""
from PIL import Image, ImageDraw, ImageChops, ImageFilter
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, "..", "web"))
ASSETS = os.path.join(WEB, "assets")
PREVIEW_DIR = os.path.join(HERE, "preview")
AI_DIR = os.path.join(PREVIEW_DIR, "ai")

FW = FH = 64
PER = 8
FOOT_Y = 55          # bbox [20,15,24,40] 的底边 = 脚点
BODY_H = 48          # 站立角色内容高度（AI 图细节多，比旧版 40 略高）
MAX_W = 50

ROWS = [
    ("walk_s",       "front"),
    ("walk_e",       "side"),
    ("walk_w",       "side_flip"),
    ("walk_n",       "back"),
    ("idle",         "front"),
    ("idle_back",    "back"),
    ("typing",       "typing"),
    ("typing_back",  "back"),
    ("read",         "read"),
    ("sleep",        "sleep"),
    ("drink",        "drink"),
    ("wave",         "wave"),
    ("lounge",       "lounge"),
    ("cheer",        "cheer"),
    ("sit",          "sit"),
    ("think",        "think"),
    ("play",         "play"),
    ("eat",          "eat"),
    ("dizzy",        "dizzy"),
    ("reach",        "wave"),
]
ACTS = {name: i for i, (name, _) in enumerate(ROWS)}

# 24 色统一调色板：把 15 张 AI 图的渐变色归并，保证精灵表像一套像素画
PALETTE = [
    (22, 32, 66), (26, 34, 68), (24, 36, 82), (33, 45, 96),
    (43, 60, 118), (50, 68, 132), (58, 84, 158), (74, 100, 165),
    (62, 126, 208), (86, 148, 205), (120, 170, 220), (140, 205, 235),
    (100, 175, 255), (150, 212, 242), (176, 220, 244), (248, 250, 255), (236, 238, 248),
    (214, 224, 240), (186, 198, 224), (150, 164, 196), (255, 233, 221),
    (244, 201, 190), (248, 168, 172), (224, 190, 120), (190, 152, 88),
]
OUTLINE = (26, 34, 68, 255)


def remove_white_bg(path, thresh=26):
    """从四角做连通域 floodfill：只删与边缘连通的白色，保留围裙/头饰的内部白。"""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    magenta = (255, 0, 255)
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(im, seed, magenta, thresh=thresh)
    r, g, b = im.split()
    mr = r.point(lambda v: 255 if v > 240 else 0)
    mg = g.point(lambda v: 255 if v < 18 else 0)
    mb = b.point(lambda v: 255 if v > 240 else 0)
    mask = ImageChops.multiply(ImageChops.multiply(mr, mg), mb)
    rgba = im.convert("RGBA")
    rgba.putalpha(ImageChops.invert(mask))
    return rgba


def resize_rgba(im, size):
    """预乘 alpha 后缩放再反预乘：避免透明黑混进边缘把角色整体压暗。"""
    a = im.getchannel("A")
    r, g, b, _ = im.split()
    sr = ImageChops.multiply(r, a).resize(size, Image.Resampling.LANCZOS)
    sg = ImageChops.multiply(g, a).resize(size, Image.Resampling.LANCZOS)
    sb = ImageChops.multiply(b, a).resize(size, Image.Resampling.LANCZOS)
    sa = a.resize(size, Image.Resampling.LANCZOS)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    po, pr, pg, pb, pa = out.load(), sr.load(), sg.load(), sb.load(), sa.load()
    for y in range(size[1]):
        for x in range(size[0]):
            av = pa[x, y]
            if av < 12:
                continue
            f = 255.0 / av
            po[x, y] = (min(255, int(pr[x, y] * f)),
                        min(255, int(pg[x, y] * f)),
                        min(255, int(pb[x, y] * f)),
                        av)
    return out


def despeckle(im):
    """去掉缩小后孤立的彩色噪点（8 邻域无同色邻居的像素换成邻域众数）。"""
    px = im.load()
    w, h = im.size
    fixes = []
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            c = px[x, y]
            if c[3] < 128:
                continue
            ns = [px[x + dx, y + dy] for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                  if (dx or dy) and px[x + dx, y + dy][3] >= 128]
            if not ns or any(n == c for n in ns):
                continue
            fixes.append((x, y, max(set(ns), key=ns.count)))
    for x, y, c in fixes:
        px[x, y] = c
    return im


def quantize(im):
    """逐像素映射到最近的调色板颜色，并把 alpha 二值化，得到硬边像素画。"""
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a < 110:
                px[x, y] = (0, 0, 0, 0)
                continue
            # 小尺寸下浅色部件（脸 / 白围裙 / 蕾丝）容易被深蓝头发吞掉，先轻提亮
            r, g, b = (min(255, int(r * 1.12 + 7)),
                       min(255, int(g * 1.12 + 7)),
                       min(255, int(b * 1.12 + 7)))
            best = min(PALETTE, key=lambda c:
                       (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2)
            px[x, y] = (best[0], best[1], best[2], 255)
    return despeckle(im)


def add_outline(im):
    a = im.getchannel("A")
    dil = a.filter(ImageFilter.MaxFilter(3))
    new = ImageChops.subtract(dil, a)
    layer = Image.new("RGBA", im.size, OUTLINE)
    layer.putalpha(new)
    return Image.alpha_composite(layer, im)


def normalize(key):
    """AI 立绘 → 一张 64x64 的对齐帧（透明底、脚点 y=55）。"""
    flip = key.endswith("_flip")
    name = key[:-5] if flip else key
    src = os.path.join(AI_DIR, name + ".png")
    if not os.path.exists(src):
        raise FileNotFoundError("缺 AI 素材: " + src)
    im = remove_white_bg(src)
    bb = im.getbbox()
    if not bb:
        raise ValueError("抠底后内容为空: " + src)
    im = im.crop(bb)
    if flip:
        im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    w, h = im.size
    if name == "lounge":
        # 横躺图按宽度定尺，压在沙发坐垫高度上
        tw = min(52, round(w / h * 30))
        th = 30
        paste_y = FOOT_Y - th
    else:
        th = BODY_H
        tw = min(MAX_W, max(10, round(w / h * th)))
        paste_y = FOOT_Y - th
    # 从 1024px 降到 ~48px：预乘 alpha 的 LANCZOS 降采样保住五官/蕾丝，
    # 再量化到固定调色板 + 去孤立噪点（直接 NEAREST 会采样出满屏杂色）
    im = resize_rgba(im, (tw, th))
    im = quantize(im)
    im = add_outline(im)
    frame = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    frame.paste(im, (FW // 2 - tw // 2, paste_y), im)
    return frame


def animate(base, key, t):
    """一行动作 8 帧：整体起伏 + 上半身 1px 轻摆，不破坏 AI 立绘的五官。"""
    out = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    ph = 2 * math.pi * t / PER
    s = math.sin(ph)
    if key.startswith("walk"):
        dy = -1 if s < -0.3 else (1 if s > 0.6 else 0)
        sway = 1 if s > 0.5 else (-1 if s < -0.5 else 0)
    elif key == "lounge":
        dy = 1 if t in (2, 3, 4, 5) else 0
        out.paste(base, (0, dy), base)
        return out
    elif key in ("idle", "idle_back", "sleep", "sit", "lounge"):
        dy = 1 if t in (2, 3, 4) else 0
        sway = 0
    else:
        dy = 0 if t % 4 in (0, 1) else 1
        sway = 1 if t % 2 == 0 else -1
    bottom = base.crop((0, 34, FW, FH))
    top = base.crop((0, 0, FW, 34))
    out.paste(bottom, (0, 34 + dy), bottom)
    out.paste(top, (sway, dy), top)
    return out


def build_sheet():
    cache = {}
    sheet = Image.new("RGBA", (FW * PER, FH * len(ROWS)), (0, 0, 0, 0))
    for row, (_, key) in enumerate(ROWS):
        if key not in cache:
            cache[key] = normalize(key)
        for t in range(PER):
            sheet.paste(animate(cache[key], key, t), (t * FW, row * FH))
    return sheet


def write_meta():
    meta = {
        "frameW": FW, "frameH": FH,
        "rows": {"South": 8, "East": 8, "West": 8, "North": 8},
        "anim": None,
        "bbox": [20, 15, 24, 40],
        "px": FW,
        "character": "whale-maid",
        "source": "ai-generated",
        "actFrames": PER,
        "frameRows": len(ROWS),
        "acts": ACTS
    }
    txt = json.dumps(meta, ensure_ascii=False) + "\n"
    with open(os.path.join(ASSETS, "whale.json"), "w", encoding="utf-8") as f:
        f.write(txt)
    man_path = os.path.join(ASSETS, "manifest.json")
    with open(man_path, encoding="utf-8") as f:
        man = json.load(f)
    man["whale"] = meta
    with open(man_path, "w", encoding="utf-8") as f:
        json.dump(man, f, ensure_ascii=False)
        f.write("\n")
    return meta


def write_preview(sheet):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    sheet.crop((0, 4 * FH, FW, 5 * FH)).resize(
        (FW * 6, FH * 6), Image.Resampling.NEAREST).save(
        os.path.join(PREVIEW_DIR, "maid-portrait.png"))
    scale, label_w = 3, 132
    pw, ph = FW * scale, FH * scale
    board = Image.new("RGB", (label_w + pw, ph * len(ROWS)), (246, 247, 251))
    d = ImageDraw.Draw(board)
    for row, (name, _) in enumerate(ROWS):
        tile = sheet.crop((0, row * FH, FW, row * FH + FH)).resize(
            (pw, ph), Image.Resampling.NEAREST)
        board.paste(tile, (label_w, row * ph), tile)
        d.text((8, row * ph + ph // 2 - 5), "%2d %s" % (row, name), fill=(38, 46, 70))
        d.line([(0, row * ph), (board.width, row * ph)], fill=(220, 224, 234))
    board.save(os.path.join(PREVIEW_DIR, "maid-actions.png"))
    keys = [("walk_s", 0), ("walk_e", 0), ("walk_w", 0), ("walk_n", 0),
            ("idle", 0), ("idle_back", 0), ("typing", 0), ("typing_back", 0),
            ("read", 0), ("sleep", 0), ("drink", 3), ("wave", 1),
            ("lounge", 0), ("cheer", 0), ("play", 0), ("dizzy", 0)]
    ks, label_h = 4, 18
    cell = FW * ks
    kb = Image.new("RGB", (cell * 8, (cell + label_h) * 2), (246, 247, 251))
    kd = ImageDraw.Draw(kb)
    for i, (name, t) in enumerate(keys):
        row = ACTS[name]
        tile = sheet.crop((t * FW, row * FH, t * FW + FW, row * FH + FH)).resize(
            (cell, cell), Image.Resampling.NEAREST)
        x, y = (i % 8) * cell, (i // 8) * (cell + label_h)
        kb.paste(tile, (x, y), tile)
        kd.text((x + 6, y + cell + 2), "%s #%d" % (name, t), fill=(38, 46, 70))
        kd.rectangle([x, y, x + cell - 1, y + cell + label_h - 1], outline=(220, 224, 234))
    kb.save(os.path.join(PREVIEW_DIR, "maid-keys.png"))
    sheet.resize((sheet.width * 2, sheet.height * 2), Image.Resampling.NEAREST).save(
        os.path.join(PREVIEW_DIR, "maid-sheet.png"))


def main():
    preview_only = "--preview" in sys.argv
    sheet = build_sheet()
    write_preview(sheet)
    if not preview_only:
        sheet.save(os.path.join(ASSETS, "whale.png"), optimize=True)
        write_meta()
    print("frames: %d (%d rows x %d), sheet: %dx%d" %
          (len(ROWS) * PER, len(ROWS), PER, sheet.width, sheet.height))
    print("ai sources: %s (%d files)" % (AI_DIR, len([f for f in os.listdir(AI_DIR) if f.endswith(".png")])))
    print("assets written: %s" % (not preview_only))


if __name__ == "__main__":
    main()
