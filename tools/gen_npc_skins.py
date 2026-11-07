#!/usr/bin/env python3
"""NPC 皮肤（v20 用户拍板：直接改精灵图）。
把 whale.png 的蓝色主体（色相 180-260°）重映射到目标色相，白脸/白肚/线稿（低饱和）与
腮红/饰品（其他色相）保留原样。输出 whale_{cat,chief,doc}.png + manifest 条目。
"""
import json
import numpy as np
from PIL import Image

ASSETS = "/root/项目/news-site/office/web/assets"

def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1); mn = rgb.min(-1)
    diff = mx - mn
    v = mx
    s = np.where(mx > 0, diff / np.maximum(mx, 1e-6), 0)
    h = np.zeros_like(mx)
    mask = diff > 1e-6
    idx = np.argmax(rgb, axis=-1)
    rr, gg, bb = mask & (idx == 0), mask & (idx == 1), mask & (idx == 2)
    h[rr] = (((g - b)[rr]) / diff[rr]) % 6
    h[gg] = ((b - r)[gg]) / diff[gg] + 2
    h[bb] = ((r - g)[bb]) / diff[bb] + 4
    return h / 6.0, s, v

def hsv_to_rgb(h, s, v):
    i = np.floor(h * 6).astype(int) % 6
    f = h * 6 - np.floor(h * 6)
    p = v * (1 - s); q = v * (1 - s * f); t = v * (1 - s * (1 - f))
    out = np.zeros(list(h.shape) + [3])
    table = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (q, p, v)]
    for c, (rr, gg, bb) in enumerate(table):
        m = i == c
        out[..., 0] = np.where(m, rr, out[..., 0])
        out[..., 1] = np.where(m, gg, out[..., 1])
        out[..., 2] = np.where(m, bb, out[..., 2])
    return out

def recolor(img, target_hue, band=(180/360, 260/360)):
    """色相在 band 内的像素重映射到 target_hue（保持 S/V 渐变）。"""
    arr = np.array(img.convert("RGBA"), dtype=np.float32) / 255.0
    rgb, a = arr[..., :3], arr[..., 3]
    h, s, v = rgb_to_hsv(rgb)
    lo, hi = band
    # 色相环距离：落在 band 内（含环绕）→ 重映射；过渡边缘 15° 线性混合，避免硬边
    def ringdist(x, y):
        d = np.abs(x - y) % 1.0
        return np.minimum(d, 1.0 - d)
    mid = (lo + hi) / 2
    half = (hi - lo) / 2
    d = ringdist(h, mid)
    w = np.clip((half + 15/360 - d) / (15/360), 0, 1)   # band 内=1，外 15° 渐隐
    h2 = h.copy()
    h2 = np.where(w > 0, (target_hue / 360.0) * w + h * (1 - w), h)
    out = hsv_to_rgb(h2, s, v)
    res = np.dstack([out, a])
    return Image.fromarray((np.clip(res, 0, 1) * 255).astype(np.uint8), "RGBA")

def main():
    base = Image.open(f"{ASSETS}/whale.png").convert("RGBA")
    manifest = json.load(open(f"{ASSETS}/manifest.json"))
    skins = [("cat", 30), ("chief", 120), ("doc", 250)]   # 橙 / 绿 / 蓝青
    for name, hue in skins:
        img = recolor(base, hue)
        img.save(f"{ASSETS}/whale_{name}.png")
        meta = dict(manifest["whale"])
        meta["skin"] = name
        manifest[f"whale_{name}"] = meta
        print(f"whale_{name}.png → hue {hue}")
    json.dump(manifest, open(f"{ASSETS}/manifest.json", "w"), ensure_ascii=False)
    print("manifest:", len(manifest))

if __name__ == "__main__":
    main()
