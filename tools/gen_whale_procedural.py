#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""鲸鱼女仆像素精灵表生成器（office/web/assets/whale.png）

形象来源：用户提供的 Q 版鲸鱼女仆（蓝渐变长发、白色荷叶边女仆头饰、
鲸鱼鳍耳与鲸尾、呆毛、深蓝裙 + 白围裙）。这里用纯 Pillow 逐像素绘制，
不依赖外部素材，保证 160 帧的角色完全一致、硬边缘、有限调色板。

布局（每帧 64x64，每行 8 帧循环，共 20 行）：
  row 0-3   行走四方向 South / East / West / North（索引与旧版完全兼容）
  row 4-19  动作行，行号见 ROWS / whale.json 的 acts 字段

用法：
  python office/tools/gen_whale.py            # 生成 whale.png + 预览图 + 元数据
  python office/tools/gen_whale.py --preview  # 只出预览，不动 assets
改完记得跑：node office/tools/bust.mjs && node office/tools/check.mjs
"""
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, "..", "web"))
ASSETS = os.path.join(WEB, "assets")
PREVIEW_DIR = os.path.join(HERE, "preview")

FW = FH = 64
PER = 8

# ---------- 有限调色板（不透明 RGBA） ----------
OUT = (26, 34, 68, 255)        # 描边 / 最深轮廓
HAIR_D = (43, 60, 118, 255)    # 深蓝发
HAIR_M = (58, 84, 158, 255)    # 中蓝发
HAIR_L = (86, 148, 205, 255)   # 浅蓝发尾
HAIR_H = (140, 205, 235, 255)  # 高光
SKIN = (255, 233, 221, 255)
SKIN_S = (244, 201, 190, 255)
BLUSH = (248, 168, 172, 255)
EYE_D = (22, 36, 82, 255)
EYE_M = (62, 126, 208, 255)
EYE_L = (150, 212, 242, 255)
WHITE = (248, 250, 255, 255)
WHITE_S = (214, 224, 240, 255)
DRESS = (33, 45, 96, 255)
DRESS_L = (50, 68, 132, 255)
GOLD = (224, 190, 120, 255)
TAIL = (40, 56, 112, 255)
TAIL_L = (74, 100, 165, 255)
SHOE = (24, 32, 66, 255)

ROWS = [
    ("walk_s",       "walk",    "s"),
    ("walk_e",       "walk",    "e"),
    ("walk_w",       "walk",    "w"),
    ("walk_n",       "walk",    "n"),
    ("idle",         "idle",    "s"),
    ("idle_back",    "idle",    "n"),
    ("typing",       "typing",  "s"),
    ("typing_back",  "typing",  "n"),
    ("read",         "read",    "s"),
    ("sleep",        "sleep",   "s"),
    ("drink",        "drink",   "s"),
    ("wave",         "wave",    "s"),
    ("lounge",       "lounge",  "s"),
    ("cheer",        "cheer",   "s"),
    ("sit",          "sit",     "s"),
    ("think",        "think",   "s"),
    ("play",         "play",    "s"),
    ("eat",          "eat",     "s"),
    ("dizzy",        "dizzy",   "s"),
    ("reach",        "reach",   "s"),
]
ACTS = {name: i for i, (name, _, _) in enumerate(ROWS)}


class Cv:
    """64x64 单帧画布；self.o 是整体上下浮动，方法自动叠加到所有 y。"""

    def __init__(self, o=0):
        self.im = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
        self.o = o

    def dot(self, x, y, c):
        x, y = int(x), int(y + self.o)
        if 0 <= x < FW and 0 <= y < FH:
            self.im.putpixel((x, y), c)

    def rect(self, x0, y0, x1, y1, c):
        ImageDraw.Draw(self.im).rectangle(
            [int(x0), int(y0 + self.o), int(x1), int(y1 + self.o)], fill=c)

    def ell(self, cx, cy, rx, ry, c):
        cy += self.o
        ImageDraw.Draw(self.im).ellipse(
            [int(cx - rx), int(cy - ry), int(cx + rx), int(cy + ry)], fill=c)

    def poly(self, pts, c):
        ImageDraw.Draw(self.im).polygon(
            [(int(x), int(y + self.o)) for x, y in pts], fill=c)

    def ink(self, col=OUT):
        """给整帧当前内容加 1px 深色外轮廓（只填透明像素，不糊内部）。"""
        a = self.im.getchannel("A")
        dil = a.filter(ImageFilter.MaxFilter(3))
        new = ImageChops.subtract(dil, a)
        layer = Image.new("RGBA", self.im.size, col)
        layer.putalpha(new)
        self.im = Image.alpha_composite(layer, self.im)

    def flip(self):
        self.im = self.im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)


def pose_for(kind, d, t):
    ph = 2 * math.pi * t / PER
    s = math.sin(ph)
    p = dict(dir=d, bob=0, leg=0, arm_l=0, arm_r=0, tail=0,
             eyes="open", mouth="smile", prop=None, prop_dy=0,
             sit=False, stars=False, wave=-1, cheer=False, reach=0)
    if kind == "walk":
        p["bob"] = -1 if s < -0.3 else (1 if s > 0.5 else 0)
        p["leg"] = 1 if s > 0.35 else (-1 if s < -0.35 else 0)
        p["arm_l"], p["arm_r"] = -p["leg"], p["leg"]
        p["tail"] = round(math.sin(ph + 1.2) * 2)
    elif kind == "idle":
        p["bob"] = 1 if t in (2, 3, 4) else 0
        p["eyes"] = "closed" if t == 5 else "open"
        p["tail"] = round(math.sin(ph))
    elif kind == "typing":
        p["arm_l"] = 1 if t % 2 == 0 else -1
        p["arm_r"] = -p["arm_l"]
        p["prop"] = "keyboard"
    elif kind == "read":
        p["prop"] = "book"
        p["prop_dy"] = -1 if t >= 4 else 0
        p["bob"] = 1 if t in (3, 4) else 0
    elif kind == "sleep":
        p["eyes"], p["mouth"] = "closed", "o"
        p["bob"] = 1 if t in (2, 3, 4, 5) else 0
    elif kind == "drink":
        p["prop"] = "cup"
        p["prop_dy"] = -3 if 2 <= t <= 5 else 0
        p["mouth"] = "o" if 3 <= t <= 5 else "smile"
        p["eyes"] = "closed" if 4 <= t <= 5 else "open"
    elif kind == "wave":
        p["wave"], p["eyes"], p["mouth"] = t, "happy", "open"
    elif kind == "cheer":
        p["cheer"], p["eyes"], p["stars"] = True, "happy", True
        p["bob"] = -1 if t % 2 == 0 else 0
    elif kind == "sit":
        p["sit"], p["bob"] = True, 2
    elif kind == "think":
        p["prop"], p["eyes"] = "pen", "wink"
    elif kind == "play":
        p["prop"] = "controller"
        p["arm_l"] = 1 if t % 2 == 0 else -1
        p["arm_r"] = -p["arm_l"]
    elif kind == "eat":
        p["prop"] = "bowl"
        p["mouth"] = "o" if t % 2 == 0 else "smile"
    elif kind == "dizzy":
        p["eyes"], p["stars"] = "dizzy", True
    elif kind == "reach":
        p["reach"] = 1 if t % 2 == 0 else 0
    elif kind == "lounge":
        p["eyes"] = "closed"
    return p


# ---------- 分层绘制 ----------
def mirror_x(pts):
    return [(FW - x, y) for x, y in pts]


def draw_tail(c, p, side=False):
    """鲸尾在右后；侧面朝向时翻到左后（像设定稿侧视图那样拖在身后）。"""
    y = p["tail"]
    parts = [
        ([(39, 42), (46, 43 + y), (51, 46 + y), (48, 50 + y), (42, 48)], TAIL),
        ([(48, 44 + y), (54, 39 + y), (58, 40 + y), (56, 46 + y), (50, 47 + y)], TAIL_L),
        ([(48, 48 + y), (56, 50 + y), (58, 53 + y), (53, 54 + y), (47, 50 + y)], TAIL_L),
        ([(51, 43 + y), (55, 41 + y), (55, 45 + y)], HAIR_H)
    ]
    for pts, col in parts:
        c.poly(mirror_x(pts) if side else pts, col)


def draw_back_mane(c, p):
    """背面设定稿：一整片深蓝→浅蓝的长发盖到裙摆，只留裙边与鞋。"""
    c.ell(32, 27, 14, 17, HAIR_D)
    c.poly([(18, 24), (46, 24), (47, 41), (45, 48), (19, 48), (17, 41)], HAIR_D)
    c.poly([(18, 36), (26, 36), (24, 48), (17, 46)], HAIR_M)
    c.poly([(38, 36), (46, 36), (47, 46), (40, 48)], HAIR_M)
    c.poly([(18, 42), (25, 42), (23, 50), (17, 48)], HAIR_L)
    c.poly([(39, 42), (46, 42), (47, 48), (41, 50)], HAIR_L)
    c.poly([(19, 46), (24, 46), (22, 51), (18, 49)], HAIR_H)
    c.poly([(40, 46), (45, 46), (46, 49), (42, 51)], HAIR_H)
    # 发丝纹理 + 头顶月牙高光
    stroke(c, [(26, 17), (25, 27), (24, 37)], HAIR_M, 1)
    stroke(c, [(32, 15), (32, 27), (32, 39)], HAIR_M, 1)
    stroke(c, [(38, 17), (39, 27), (40, 37)], HAIR_M, 1)
    c.poly([(24, 13), (30, 11), (36, 12), (34, 15), (26, 15)], HAIR_M)
    c.dot(28, 14, HAIR_H)
    c.dot(33, 13, HAIR_H)


def draw_back_hair(c, p, back):
    c.ell(32, 27, 15, 16, HAIR_D)
    c.poly([(18, 30), (23, 30), (22, 44), (16, 42)], HAIR_M)
    c.poly([(41, 30), (46, 30), (48, 42), (42, 44)], HAIR_M)
    c.poly([(17, 38), (23, 39), (21, 48), (15, 46)], HAIR_L)
    c.poly([(41, 39), (47, 38), (49, 46), (43, 48)], HAIR_L)
    c.poly([(18, 43), (22, 43), (20, 49), (16, 47)], HAIR_H)
    c.poly([(42, 43), (46, 43), (48, 47), (44, 49)], HAIR_H)
    if back:
        # 后脑：整块发 + 两道月牙高光
        c.ell(32, 25, 12, 11, HAIR_D)
        c.poly([(24, 19), (28, 17), (38, 17), (40, 19), (34, 20), (27, 21)], HAIR_M)
        c.poly([(23, 26), (26, 24), (27, 25), (24, 29)], HAIR_L)
        c.poly([(38, 25), (41, 24), (41, 28), (39, 27)], HAIR_L)


def draw_body(c, p, back, side):
    leg = p["leg"]
    if p["sit"]:
        c.rect(25, 46, 30, 51, WHITE)
        c.rect(34, 46, 39, 51, WHITE)
        c.rect(24, 50, 31, 54, SHOE)
        c.rect(33, 50, 40, 54, SHOE)
    else:
        c.rect(27, 47, 30, 51, WHITE)
        c.rect(34, 47, 37, 51, WHITE)
        c.rect(26 + leg, 50, 30 + leg, 54, SHOE)
        c.rect(34 - leg, 50, 38 - leg, 54, SHOE)
        c.rect(26 + leg, 54, 30 + leg, 55, OUT)
        c.rect(34 - leg, 54, 38 - leg, 55, OUT)
    # 裙摆
    c.poly([(24, 37), (40, 37), (45, 48), (19, 48)], DRESS)
    c.poly([(20, 47), (44, 47), (45, 50), (19, 50)], WHITE)
    for x in range(21, 45, 4):
        c.ell(x, 50, 2, 1, WHITE_S)
    c.poly([(26, 40), (28, 40), (27, 47), (25, 47)], DRESS_L)
    c.poly([(36, 40), (38, 40), (39, 47), (37, 47)], DRESS_L)
    # 上衣
    c.rect(25, 31, 39, 40, DRESS)
    c.rect(25, 31, 39, 32, DRESS_L)
    if back:
        # 背面：后腰大蝴蝶结 + 两道裙褶
        c.poly([(32, 36), (25, 33), (25, 41)], WHITE_S)
        c.poly([(32, 36), (39, 33), (39, 41)], WHITE_S)
        c.rect(30, 34, 34, 38, WHITE)
        c.rect(31, 35, 33, 37, WHITE_S)
    else:
        # 白围裙 + 围裙上的小鲸鱼
        c.poly([(27, 34), (37, 34), (40, 47), (24, 47)], WHITE)
        c.rect(24, 46, 40, 48, WHITE_S)
        c.ell(32, 41, 3, 2, HAIR_M)
        c.poly([(34, 40), (37, 39), (36, 43)], HAIR_M)
        c.dot(31, 40, WHITE)
        c.dot(30, 38, HAIR_D)
        c.dot(29, 37, HAIR_L)
        c.rect(27, 34, 37, 35, WHITE)
        c.rect(28, 36, 29, 37, GOLD)
        c.rect(35, 36, 36, 37, GOLD)
    # 领口 + 领结
    c.poly([(28, 31), (36, 31), (32, 36)], WHITE)
    c.poly([(29, 33), (32, 31), (32, 35)], HAIR_D)
    c.poly([(35, 33), (32, 31), (32, 35)], HAIR_D)
    c.rect(31, 32, 33, 34, HAIR_M)
    c.dot(32, 33, GOLD)
    # 裙摆金色小刺绣 / 蝴蝶结（设定稿下摆装饰），画在围裙之后但不压围裙
    for gx, gy in [(22, 44), (42, 44), (26, 47), (38, 47)]:
        c.dot(gx, gy, GOLD)
        c.dot(gx - 1, gy, GOLD)
        c.dot(gx + 1, gy, GOLD)
        c.dot(gx, gy - 1, GOLD)
    c.poly([(21, 42), (24, 41), (24, 45)], GOLD)
    c.poly([(43, 42), (40, 41), (40, 45)], GOLD)


def draw_arms(c, p, back, side):
    al, ar = p["arm_l"], p["arm_r"]
    if p["wave"] >= 0:
        sw = (p["wave"] % 4) - 1.5
        c.poly([(38, 33), (43, 33), (46 + sw, 24), (42 + sw, 23)], DRESS)
        c.ell(44 + sw, 22, 3, 3, SKIN)
        c.rect(20, 34, 24, 41, DRESS)
        c.ell(22, 42, 2, 2, SKIN)
        return
    if p["cheer"]:
        c.poly([(23, 34), (27, 34), (21, 22), (17, 24)], DRESS)
        c.poly([(37, 34), (41, 34), (47, 22), (43, 20)], DRESS)
        c.ell(19, 21, 3, 3, SKIN)
        c.ell(45, 21, 3, 3, SKIN)
        return
    if p["reach"]:
        c.poly([(38, 33), (43, 33), (50, 37), (49, 40)], DRESS)
        c.ell(50, 38, 3, 2, SKIN)
        c.rect(20, 34, 24, 41, DRESS)
        c.ell(22, 42, 2, 2, SKIN)
        return
    # 常规双臂（袖口 + 手），al/ar 让手上下敲动
    c.rect(20, 34, 24, 40, DRESS)
    c.rect(20, 39, 24, 40, DRESS_L)
    c.ell(22, 41 + al, 2, 2, SKIN)
    c.rect(40, 34, 44, 40, DRESS)
    c.rect(40, 39, 44, 40, DRESS_L)
    c.ell(42, 41 + ar, 2, 2, SKIN)


def draw_head(c, p, side):
    if side:
        # 设定稿侧视图：脸朝右，长卷发整片拖在左后方
        c.ell(35, 26, 9, 9, SKIN)
        c.poly([(28, 32), (43, 32), (40, 35), (30, 35)], SKIN)
        c.poly([(17, 13), (33, 11), (32, 45), (16, 42)], HAIR_D)
        c.poly([(17, 31), (30, 33), (28, 46), (16, 44)], HAIR_M)
        c.poly([(17, 39), (28, 41), (26, 49), (16, 47)], HAIR_L)
        c.poly([(18, 44), (26, 46), (24, 50), (17, 49)], HAIR_H)
        c.ell(33, 18, 11, 7, HAIR_D)
        c.poly([(24, 14), (44, 14), (44, 22), (41, 19), (38, 24),
                (35, 20), (32, 24), (29, 20), (26, 23), (24, 21)], HAIR_M)
        c.poly([(24, 14), (34, 12), (43, 14), (44, 17), (25, 17)], HAIR_D)
        c.dot(30, 15, HAIR_H)
        c.dot(29, 16, HAIR_H)
        return
    c.ell(32, 26, 10, 9, SKIN)          # 脸
    c.poly([(24, 32), (40, 32), (37, 35), (27, 35)], SKIN)
    c.ell(32, 18, 13, 7, HAIR_D)        # 头顶发
    c.poly([(20, 15), (44, 15), (44, 22), (41, 19), (38, 25), (35, 20),
            (32, 25), (29, 20), (26, 25), (23, 19), (20, 22)], HAIR_M)
    c.poly([(21, 15), (31, 13), (40, 14), (44, 16), (43, 18), (23, 18)], HAIR_D)
    c.poly([(27, 14), (31, 13), (30, 17), (26, 18)], HAIR_M)
    c.dot(30, 15, HAIR_H)
    c.dot(29, 16, HAIR_H)
    c.poly([(19, 18), (24, 18), (23, 38), (18, 36)], HAIR_D)
    c.poly([(40, 18), (45, 18), (46, 36), (41, 38)], HAIR_D)
    c.poly([(18, 32), (23, 34), (21, 43), (17, 40)], HAIR_L)
    c.poly([(41, 34), (46, 32), (47, 40), (43, 43)], HAIR_L)


def stroke(c, pts, color, w=2):
    """沿折线画连续粗线（逐点插值，不产生虚线方块）。"""
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for k in range(n + 1):
            x = x0 + (x1 - x0) * k / n
            y = y0 + (y1 - y0) * k / n
            c.rect(x, y, x + w - 1, y + w - 1, color)


def bow(c, x, y):
    """浅蓝双翼蝴蝶结（设定稿里正面右侧一枚、背面左右各一枚）。"""
    c.poly([(x, y), (x + 7, y - 4), (x + 7, y + 4)], HAIR_L)
    c.poly([(x, y), (x - 5, y - 3), (x - 5, y + 3)], EYE_L)
    c.rect(x - 2, y - 2, x + 2, y + 2, HAIR_D)
    c.rect(x - 1, y - 1, x + 1, y + 1, HAIR_L)
    c.dot(x, y - 1, WHITE)


def draw_accessories(c, p, back, side):
    # 白色蕾丝发带：绕头顶的倒 U 弧，三视图里都是这条弧而不是平顶帽
    for x in range(19, 46):
        t = max(-1.0, min(1.0, (x - 32) / 13.0))
        yy = 9 + round(10 * (1 - math.sqrt(max(0.0, 1 - t * t))))
        w = round(0.8 * math.sin(x * 1.7))
        c.rect(x, yy + w, x, yy + w + 3, WHITE)
        c.dot(x, yy + w + 3, WHITE_S)
    # 呆毛：头顶左上翘起的连贯弯钩
    stroke(c, [(30, 13), (29, 10), (28, 8), (26, 6), (23, 5), (21, 6), (20, 8)], HAIR_D)
    stroke(c, [(28, 9), (26, 7), (23, 6)], HAIR_M, 1)
    c.dot(23, 5, HAIR_H)
    c.dot(22, 6, HAIR_H)
    # 蝴蝶结
    bow(c, 45, 19)
    if back:
        bow(c, 19, 19)
    # 鲸鱼鳍耳（深蓝外鳍 + 浅蓝内鳍）
    c.poly([(19, 23), (12, 21), (14, 29), (20, 29)], HAIR_D)
    c.poly([(45, 23), (52, 21), (50, 29), (44, 29)], HAIR_D)
    c.poly([(17, 24), (14, 23), (15, 27), (19, 27)], TAIL_L)
    c.poly([(47, 24), (50, 23), (49, 27), (45, 27)], TAIL_L)


def draw_eye(c, x, y, how):
    """设定稿的大圆蓝眼：5x6 眼框 + 眼白 + 蓝瞳 + 高光。"""
    if how == "closed":
        c.rect(x - 2, y + 1, x + 2, y + 1, EYE_D)
        c.dot(x - 3, y, EYE_D)
        c.dot(x + 3, y, EYE_D)
        return
    if how == "happy":
        c.dot(x - 3, y + 2, EYE_D)
        c.dot(x - 2, y + 3, EYE_D)
        c.dot(x - 1, y + 2, EYE_D)
        c.dot(x + 1, y + 2, EYE_D)
        c.dot(x + 2, y + 3, EYE_D)
        c.dot(x + 3, y + 2, EYE_D)
        return
    if how == "dizzy":
        for k in range(5):
            c.dot(x - 2 + k, y - 1 + k, EYE_D)
            c.dot(x + 2 - k, y - 1 + k, EYE_D)
        return
    c.rect(x - 1, y - 2, x + 1, y + 3, EYE_D)   # 八边形眼框，去掉四个直角
    c.rect(x - 2, y - 1, x + 2, y + 2, EYE_D)
    c.rect(x - 1, y - 1, x + 1, y + 2, WHITE)   # 眼白
    c.rect(x - 1, y, x + 1, y + 2, EYE_M)       # 蓝瞳
    c.dot(x - 1, y, WHITE)                      # 高光
    c.dot(x + 1, y + 2, EYE_L)
    c.rect(x - 2, y - 3, x + 2, y - 3, HAIR_D)  # 眉/睫毛
    if how == "wink":
        c.rect(x - 1, y - 2, x + 1, y + 3, SKIN)
        c.rect(x - 2, y - 1, x + 2, y + 2, SKIN)
        c.rect(x - 2, y + 1, x + 2, y + 1, EYE_D)


def draw_features(c, p, back, side):
    if back:
        return
    eye = p["eyes"]
    if side:
        draw_eye(c, 37, 25, eye)
        c.rect(31, 31, 33, 31, BLUSH)
        c.dot(43, 29, SKIN_S)
    else:
        draw_eye(c, 27, 25, "wink" if eye == "wink" else eye)
        draw_eye(c, 36, 25, eye)
        c.rect(23, 31, 25, 31, BLUSH)
        c.rect(39, 31, 41, 31, BLUSH)
    m = p["mouth"]
    if m == "o":
        c.ell(32, 32, 1, 1, SKIN_S)
    elif m == "open":
        c.rect(30, 31, 34, 33, EYE_D)
        c.rect(31, 32, 33, 33, (240, 130, 150, 255))
    else:
        c.dot(31, 32, SKIN_S)
        c.dot(32, 33, SKIN_S)
        c.dot(33, 32, SKIN_S)


def draw_prop(c, p):
    # 挥手的手臂补画在最上层：否则会被头饰 / 鳍耳 / 蝴蝶结盖住，动作看不出来
    if p["wave"] >= 0:
        sw = (p["wave"] % 4) - 1.5
        c.poly([(39, 35), (44, 35), (48 + sw, 22), (43 + sw, 20)], DRESS)
        c.rect(43 + sw, 18, 47 + sw, 22, SKIN)
        c.rect(44 + sw, 17, 46 + sw, 18, SKIN)
        c.dot(45 + sw, 20, SKIN_S)
    k, d = p["prop"], p["prop_dy"]
    if not k:
        return
    if k == "keyboard":
        c.rect(23, 43, 41, 47, OUT)
        c.rect(24, 44, 40, 46, WHITE_S)
        for x in range(26, 40, 3):
            c.dot(x, 45, WHITE)
    elif k == "book":
        c.poly([(24, 39 + d), (32, 41 + d), (32, 47 + d), (24, 45 + d)], OUT)
        c.poly([(40, 39 + d), (32, 41 + d), (32, 47 + d), (40, 45 + d)], OUT)
        c.poly([(25, 40 + d), (31, 41 + d), (31, 45 + d), (25, 44 + d)], WHITE)
        c.poly([(39, 40 + d), (33, 41 + d), (33, 45 + d), (39, 44 + d)], WHITE)
        c.rect(25, 39 + d, 39, 40 + d, HAIR_M)
    elif k == "cup":
        c.rect(34, 32 + d, 40, 38 + d, OUT)
        c.rect(35, 33 + d, 39, 37 + d, WHITE)
        c.rect(36, 34 + d, 38, 36 + d, HAIR_L)
        c.rect(40, 34 + d, 42, 36 + d, OUT)
        c.rect(41, 35 + d, 41, 35 + d, WHITE)
    elif k == "controller":
        c.ell(32, 42, 8, 4, OUT)
        c.ell(32, 42, 7, 3, HAIR_M)
        c.rect(27, 41, 29, 43, WHITE_S)
        c.dot(36, 41, GOLD)
        c.dot(37, 42, GOLD)
    elif k == "pen":
        c.poly([(38, 38), (43, 29), (45, 30), (40, 39)], GOLD)
        c.dot(44, 29, OUT)
        c.ell(27, 33, 3, 2, SKIN)
    elif k == "bowl":
        c.poly([(26, 42), (38, 42), (36, 47), (28, 47)], OUT)
        c.poly([(27, 43), (37, 43), (35, 46), (29, 46)], WHITE)
        c.rect(27, 42, 37, 42, HAIR_L)
        c.poly([(40, 33), (41, 33), (38, 42), (37, 42)], WHITE_S)
    if p["stars"]:
        for sx, sy in [(16, 17), (48, 14), (21, 9), (45, 8)]:
            c.dot(sx, sy, GOLD)
            c.dot(sx - 1, sy, WHITE)
            c.dot(sx + 1, sy, WHITE)
            c.dot(sx, sy - 1, WHITE)
            c.dot(sx, sy + 1, WHITE)


def draw_char(p):
    d = p["dir"]
    back = (d == "n")
    side = (d in ("e", "w"))
    # 'w' 直接镜像 'e'，保证左右帧完全对称
    if d == "w":
        q = dict(p)
        q["dir"] = "e"
        im = draw_char(q)
        im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        return im
    c = Cv(p["bob"])
    draw_tail(c, p, side)
    if not back:
        draw_back_hair(c, p, False)      # 正面/侧面：两侧长发在身体之后
    draw_body(c, p, back, side)
    draw_arms(c, p, back, side)
    if back:
        # 背面设定稿：整片长发盖到裙摆，只露裙边与鞋；五官不画
        draw_back_mane(c, p)
        draw_accessories(c, p, True, False)
        if p["prop"] == "keyboard":     # typing_back 仍露出身前键盘一角
            c.rect(24, 47, 40, 49, OUT)
            c.rect(25, 47, 39, 48, WHITE_S)
    else:
        draw_head(c, p, side)
        draw_accessories(c, p, False, side)
        draw_features(c, p, False, side)
        draw_prop(c, p)
    c.ink()
    return c.im


def draw_lounge(t):
    """横躺帧：闭眼站立帧逆时针旋转 90° 后压扁，垫上枕头。"""
    base = draw_char(pose_for("sleep", "s", min(t, 7)))
    rot = base.rotate(90, resample=Image.Resampling.NEAREST, expand=False)
    bb = rot.getbbox()
    content = rot.crop(bb) if bb else rot
    w, h = 46, 22
    content = content.resize((w, h), Image.Resampling.NEAREST)
    frame = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    bob = 1 if t in (2, 3, 4, 5) else 0
    frame.paste(content, (32 - w // 2, 54 - h - bob), content)
    d = ImageDraw.Draw(frame)
    # 枕头
    d.rounded_rectangle([6, 36 - bob, 20, 48 - bob], radius=3, fill=WHITE, outline=OUT, width=1)
    d.line([8, 40 - bob, 18, 40 - bob], fill=WHITE_S)
    return frame


def build_sheet():
    sheet = Image.new("RGBA", (FW * PER, FH * len(ROWS)), (0, 0, 0, 0))
    for row, (name, kind, d) in enumerate(ROWS):
        for t in range(PER):
            if kind == "lounge":
                im = draw_lounge(t)
            else:
                im = draw_char(pose_for(kind, d, t))
            sheet.paste(im, (t * FW, row * FH), im)
    return sheet


def write_meta():
    meta = {
        "frameW": FW, "frameH": FH,
        "rows": {"South": 8, "East": 8, "West": 8, "North": 8},
        "anim": None,
        "bbox": [20, 15, 24, 40],
        "px": FW,
        "character": "whale-maid",
        "actFrames": PER,
        "frameRows": len(ROWS),
        "acts": ACTS
    }
    # 保持与仓库里其他 json 一致的 dumps 默认格式，避免整文件 diff
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
    # 单角色定妆图（idle 首帧 6 倍放大）
    pose = sheet.crop((0, 4 * FH, FW, 5 * FH))
    pose.resize((FW * 6, FH * 6), Image.Resampling.NEAREST).save(
        os.path.join(PREVIEW_DIR, "maid-portrait.png"))
    # 动作表缩略：每行动作取第 0 帧，3 倍放大 + 行标签
    scale, label_w = 3, 132
    pw, ph = FW * scale, FH * scale
    board = Image.new("RGB", (label_w + pw, ph * len(ROWS)), (246, 247, 251))
    d = ImageDraw.Draw(board)
    for row, (name, _, _) in enumerate(ROWS):
        tile = sheet.crop((0, row * FH, FW, row * FH + FH)).resize(
            (pw, ph), Image.Resampling.NEAREST)
        board.paste(tile, (label_w, row * ph), tile)
        d.text((8, row * ph + ph // 2 - 5), "%2d %s" % (row, name), fill=(38, 46, 70))
        d.line([(0, row * ph), (board.width, row * ph)], fill=(220, 224, 234))
    board.save(os.path.join(PREVIEW_DIR, "maid-actions.png"))
    # 关键帧对比：2 行 x 8 格，4 倍放大，便于人工走查朝向 / 姿势 / 道具
    keys = [("walk_s", 0), ("walk_e", 0), ("walk_w", 0), ("walk_n", 0),
            ("idle", 0), ("idle_back", 0), ("typing", 0), ("typing_back", 0),
            ("read", 0), ("sleep", 0), ("drink", 3), ("wave", 1),
            ("lounge", 0), ("cheer", 0), ("play", 0), ("dizzy", 0)]
    ks, label_h = 4, 18
    cell = FW * ks
    keys_board = Image.new("RGB", (cell * 8, (cell + label_h) * 2), (246, 247, 251))
    kd = ImageDraw.Draw(keys_board)
    for i, (name, t) in enumerate(keys):
        row = ACTS[name]
        tile = sheet.crop((t * FW, row * FH, t * FW + FW, row * FH + FH)).resize(
            (cell, cell), Image.Resampling.NEAREST)
        x, y = (i % 8) * cell, (i // 8) * (cell + label_h)
        keys_board.paste(tile, (x, y), tile)
        kd.text((x + 6, y + cell + 2), "%s #%d" % (name, t), fill=(38, 46, 70))
        kd.rectangle([x, y, x + cell - 1, y + cell + label_h - 1], outline=(220, 224, 234))
    keys_board.save(os.path.join(PREVIEW_DIR, "maid-keys.png"))
    # 完整精灵表（2 倍）
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
    print("preview: %s" % PREVIEW_DIR)
    print("assets written: %s" % (not preview_only))


if __name__ == "__main__":
    main()
