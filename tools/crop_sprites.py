#!/usr/bin/env python3
"""办公室前端资产准备 v2：从 pixor 包裁出 Phaser 用的精灵表。

输出约定（前端 office.js 依赖）：
  web/assets/<name>.png   精灵表：行序固定 South(0) East(1) West(2) North(3)，帧宽=frameW
  web/assets/<name>.json  { frameW, frameH, rows:{South,East,West,North}, anim:{name,fps}|null,
                            bbox:[x,y,w,h] 第0帧内容包围盒（真实体积，用于锚点/碰撞/深度） }

JSON 坐标系 = 该包 aseprite 的 native 尺寸；输出表尺寸 px 可不同，等比换算。
"""
import glob
import json
import os
from PIL import Image

EX = os.environ.get("OFFICE_EXTRACT_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "extracted")
OUT = os.environ.get("OFFICE_WEB_ASSETS") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "assets")
SIDES = ["South", "East", "West", "North"]

os.makedirs(OUT, exist_ok=True)

def pkg_dir(asset):
    return os.path.join(EX, f"pixor-library-{asset}", f"pixor-library-{asset}")

def load_json(asset):
    js = sorted(glob.glob(os.path.join(pkg_dir(asset), "aseprite", "*.json")))
    return js[0] if js else None

def sheet_for(asset, px):
    p = os.path.join(pkg_dir(asset), "sprites", "selout", f"{asset}-{px}px-8-sides.png")
    return p if os.path.exists(p) else None

def native_px(asset):
    jp = load_json(asset)
    if not jp:
        return None
    d = json.load(open(jp))
    frames = d["frames"] if isinstance(d["frames"], list) else list(d["frames"].values())
    return frames[0]["frame"]["w"]

def crop_rows(asset, px, animated):
    jp = load_json(asset)
    d = json.load(open(jp))
    frames = d["frames"] if isinstance(d["frames"], list) else list(d["frames"].values())
    ratio = px / native_px(asset)
    sheet = Image.open(sheet_for(asset, px)).convert("RGBA")
    rows = {}
    for f in frames:
        side = f["pixor"]["tag"].split("_", 1)[1]
        if side in SIDES:
            rows.setdefault(side, []).append(f)
    if not rows:
        return None
    fh = round(max(f["frame"]["h"] for v in rows.values() for f in v) * ratio)
    east = rows.get("East", [])
    anim_name = east[0]["pixor"]["action"] if (animated and len(east) > 1) else None
    out = Image.new("RGBA", (max(len(v) for v in rows.values()) * fh, fh * 4), (0, 0, 0, 0))
    row_n = {}
    for i, side in enumerate(SIDES):
        cells = rows.get(side, [])
        row_n[side] = len(cells)
        for j, f in enumerate(cells):
            fr = f["frame"]
            cell = sheet.crop((round(fr["x"] * ratio), round(fr["y"] * ratio),
                               round((fr["x"] + fr["w"]) * ratio), round((fr["y"] + fr["h"]) * ratio)))
            out.paste(cell, (j * fh, i * fh))
    meta = {"frameW": fh, "frameH": fh, "rows": row_n,
            "anim": ({"name": anim_name, "fps": 8} if anim_name else None)}
    return out, meta

def crop_static(asset, px):
    sheet = Image.open(sheet_for(asset, px)).convert("RGBA")
    rh = sheet.height // 8
    out = Image.new("RGBA", (rh, rh), (0, 0, 0, 0))
    out.paste(sheet.crop((0, 0, rh, rh)), (0, 0))
    return out, {"frameW": rh, "frameH": rh, "rows": {"South": 1, "East": 0, "West": 0, "North": 0}, "anim": None}

ANIMATED = {"computer", "printer", "globe-desk", "office-chair", "filing-cabinet",
            "locker", "phone-desk", "calculator", "coffee-mug", "stapler", "open-book", "clock-desk"}

ASSETS = {
    "whale": 64, "office-desk": 48, "office-chair": 48, "computer": 48,
    "desk-wood": 64, "dining-table": 64, "nightstand": 48, "school-desk": 48, "chair": 48,
    "double-bed": 48, "bed": 64, "wardrobe": 48, "curtains": 64, "mirror": 64,
    "toilet": 40, "bathtub": 64, "fridge": 64, "stove-kitchen": 64, "kitchen-counter": 64,
    "sink": 48, "fruit-bowl": 48, "kettle": 48, "mailbox": 40, "armchair": 48,
    "gramophone": 64, "arcade-cabinet": 48, "crown-cushion": 40, "bench-park": 48,
    "oak-tree": 112, "street-lamp": 64, "market-stall": 64, "stall-fruit": 64,
    "coin": 32, "potion-shelf": 64, "fence": 64, "sign-inn": 48, "fence-picket": 48,
    "bush": 56, "flowers": 64,
    "cottage": 64, "house-modern": 64, "farmhouse": 64, "well": 64,
    "robe": 64, "wizard-hat": 64, "amulet": 48,
    "laptop": 48, "printer": 48, "filing-cabinet": 48, "bookshelf-office": 48,
    "whiteboard": 48, "water-cooler": 48, "desk-lamp": 48, "plant-office": 48,
    "coffee-mug": 48, "paper-stack": 48, "locker": 48, "clock-desk": 48,
    "pencil-cup": 48, "stapler": 48, "calculator": 48, "phone-desk": 48,
    "globe-desk": 48, "trophy-cup": 48, "blackboard": 48, "sofa": 48,
    "floor-lamp": 48, "cabinet": 48, "open-book": 48, "book-stack": 48,
    "round-table": 48,
}

report = []
for asset, target_px in ASSETS.items():
    if asset == "whale":
        report.append("SKIP whale: 由 tools/gen_whale.py 单独生成，crop 不得覆盖")
        continue
    native = native_px(asset)
    if asset == "whale":
        px = 64
    elif native and native < target_px:
        px = native
    else:
        px = target_px
    try:
        if load_json(asset) and sheet_for(asset, px):
            img, meta = crop_rows(asset, px, asset in ANIMATED)
        elif sheet_for(asset, target_px):
            img, meta = crop_static(asset, target_px)
            px = target_px
        else:
            report.append(f"FAIL {asset}: no sheet")
            continue
        img.save(f"{OUT}/{asset}.png")
        # 第 0 帧内容包围盒（真实体积）——锚点/碰撞/深度的依据
        cell = img.crop((0, 0, meta["frameW"], meta["frameH"]))
        bbox = cell.getbbox() or [0, 0, 0, 0]
        meta["bbox"] = [bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1]]
        meta["px"] = px
        json.dump(meta, open(f"{OUT}/{asset}.json", "w"))
        report.append(f"OK {asset}: px={px} frameW={meta['frameW']} rows={meta['rows']} bbox={meta['bbox']}")
    except Exception as e:
        report.append(f"FAIL {asset}: {e}")

print("\n".join(report))
