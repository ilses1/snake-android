#!/usr/bin/env python3
"""从主仓库的 1024x1024 源图标生成 Android 启动图标。

产物（写到 app/src/main/res/）：
  mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png            方形（API < 26 用）
  mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher_foreground.png 自适应前景（API 26+）
  （背景色是纯色，由 res/values/colors.xml 的 ic_launcher_background 提供）

自适应图标规范：
  画布 = 108dp，系统遮罩（圆/方/圆角方/水滴）只保证显示中心 66dp 安全区。
  源图标里的瓷片占画布 80%，直接铺满 108dp 会被圆形遮罩切掉四角，
  所以这里把源图缩到 70% 居中——瓷片完整落在圆内，四周留出标准留白。

用法：
  python make-icons.py [源图标路径]
默认源路径指向同级 snake-3d-tauri 仓库的 tauri-app/icon.png。
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.normpath(os.path.join(HERE, "..", "app", "src", "main", "res"))
DEFAULT_SRC = os.path.normpath(
    os.path.join(HERE, "..", "..", "2026-09-28-17-24-07", "tauri-app", "icon.png")
)

# (目录名, 像素边长)
LEGACY = [("mipmap-mdpi", 48), ("mipmap-hdpi", 72), ("mipmap-xhdpi", 96),
          ("mipmap-xxhdpi", 144), ("mipmap-xxxhdpi", 192)]
# 自适应前景画布是 108dp，逐密度放大
FOREGROUND = [("mipmap-mdpi", 108), ("mipmap-hdpi", 162), ("mipmap-xhdpi", 216),
              ("mipmap-xxhdpi", 324), ("mipmap-xxxhdpi", 432)]
FOREGROUND_SCALE = 0.70


def sample_background(im):
    """取四角 16x16 的平均色，作为自适应图标的背景色。"""
    w, h = im.size
    rgb = im.convert("RGB")
    pts = []
    for cx, cy in ((0, 0), (w - 16, 0), (0, h - 16), (w - 16, h - 16)):
        for y in range(cy, cy + 16):
            for x in range(cx, cx + 16):
                pts.append(rgb.getpixel((x, y)))
    n = len(pts)
    r = sum(p[0] for p in pts) // n
    g = sum(p[1] for p in pts) // n
    b = sum(p[2] for p in pts) // n
    return "#{:02X}{:02X}{:02X}".format(r, g, b)


def make_foreground(im, size):
    """源图缩放到 FOREGROUND_SCALE，居中放到透明画布上。"""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = round(size * FOREGROUND_SCALE)
    tile = im.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    canvas.paste(tile, (off, off), tile if tile.mode == "RGBA" else None)
    return canvas


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.isfile(src):
        sys.exit("找不到源图标：%s\n用法：python make-icons.py <1024x1024.png>" % src)

    im = Image.open(src).convert("RGBA")
    print("源图标：%s  %sx%s" % (src, *im.size))

    bg = sample_background(im)
    print("采样背景色：%s （请同步到 res/values/colors.xml 的 ic_launcher_background）" % bg)

    for folder, size in LEGACY:
        d = os.path.join(RES, folder)
        os.makedirs(d, exist_ok=True)
        out = os.path.join(d, "ic_launcher.png")
        im.resize((size, size), Image.LANCZOS).save(out, optimize=True)
        print("  %-24s ic_launcher.png            %4dpx" % (folder, size))

    for folder, size in FOREGROUND:
        d = os.path.join(RES, folder)
        os.makedirs(d, exist_ok=True)
        out = os.path.join(d, "ic_launcher_foreground.png")
        make_foreground(im, size).save(out, optimize=True)
        print("  %-24s ic_launcher_foreground.png %4dpx" % (folder, size))

    print("完成。")


if __name__ == "__main__":
    main()
