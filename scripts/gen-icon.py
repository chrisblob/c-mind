#!/usr/bin/env python3
"""
C-Mind 图标生成脚本
- 底板：macOS 规范的圆角方形，靛蓝→青色对角渐变
- 图形：白色「中心节点 + C 形弧 + 三个分支节点」
  语义：C = Connect / Chain / Create，弧线既是字母 C，也是导图的分支轨迹
输出：build/icon.png (1024)、build/icon-512.png
"""
import os
import math
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'build')
os.makedirs(BUILD, exist_ok=True)

S = 1024
C1 = (76, 110, 245)   # #4C6EF5 靛蓝
C2 = (34, 184, 207)   # #22B8CF 青色


def rounded_gradient_canvas():
    """对角渐变 + 圆角矩形蒙版"""
    # 用 numpy 快速生成对角渐变
    import numpy as np
    xs = np.linspace(0, 1, S)[None, :]
    ys = np.linspace(0, 1, S)[:, None]
    t = (xs * 0.6 + ys * 0.4)  # 对角权重
    r = (C1[0] + (C2[0] - C1[0]) * t)
    g = (C1[1] + (C2[1] - C1[1]) * t)
    b = (C1[2] + (C2[2] - C1[2]) * t)
    arr = np.stack([r, g, b], axis=-1).astype('uint8')
    img = Image.fromarray(arr, 'RGB').convert('RGBA')

    # macOS 图标规范：内容区约 824x824 居中，四周留透明边
    pad = 100
    size = S - pad * 2
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.225), fill=255)

    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    inner = img.crop((pad, pad, S - pad, S - pad))
    canvas.paste(inner, (pad, pad), mask)
    return canvas


def draw_glyph(canvas):
    d = ImageDraw.Draw(canvas)
    cx, cy = 486.0, 512.0  # 视觉中心（略微左移给 C 开口留白）
    WHITE = (255, 255, 255, 255)

    lw = 26
    # C 形弧线（右侧开口）：PIL 角度顺时针、3 点钟为 0°
    radius = 268
    bbox = [cx - radius, cy - radius, cx + radius, cy + radius]
    d.arc(bbox, start=45, end=315, fill=WHITE, width=lw)

    # 中心节点
    d.ellipse([cx - 74, cy - 74, cx + 74, cy + 74], fill=WHITE)

    # 三个分支节点（上 / 左 / 下）+ 连接线
    for angle in (270, 180, 90):  # 顶部、左侧、底部
        a = math.radians(angle)
        px, py = cx + radius * math.cos(a), cy + radius * math.sin(a)
        d.line([cx, cy, px, py], fill=WHITE, width=lw)
        r = 48
        d.ellipse([px - r, py - r, px + r, py + r], fill=WHITE)

    # C 开口两端的收尾小圆点
    for angle in (45, 315):
        a = math.radians(angle)
        px, py = cx + radius * math.cos(a), cy + radius * math.sin(a)
        r = 30
        d.ellipse([px - r, py - r, px + r, py + r], fill=WHITE)
    return canvas


if __name__ == '__main__':
    icon = draw_glyph(rounded_gradient_canvas())
    icon.save(os.path.join(BUILD, 'icon.png'))
    icon.resize((512, 512), Image.LANCZOS).save(os.path.join(BUILD, 'icon-512.png'))
    print('OK ->', os.path.join(BUILD, 'icon.png'))
