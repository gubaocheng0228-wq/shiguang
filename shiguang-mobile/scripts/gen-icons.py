import os
from PIL import Image

SRC = r"C:\Users\Lenovo legion r7000p\Documents\deepseek-harness\default-workspace\shiguang\build\icon.png"
RES = r"C:\Users\Lenovo legion r7000p\Documents\deepseek-harness\default-workspace\shiguang-mobile\app\src\main\res"

src = Image.open(SRC).convert("RGBA")
print("source", src.size)

# 1) 传统方形图标（现代启动器仍会用到，也用于旧系统）
legacy = {
    "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192,
}
for dens, size in legacy.items():
    d = os.path.join(RES, "mipmap-" + dens)
    os.makedirs(d, exist_ok=True)
    img = src.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(d, "ic_launcher.png"), "PNG", optimize=True)
    print("legacy", dens, size)

# 2) 自适应图标前景：只留金色星光，抠成透明
w, h = src.size
px = src.load()
fg = Image.new("RGBA", (w, h), (0, 0, 0, 0))
fp = fg.load()
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        # 背景是暗棕黑（lum<60），星光是暖金/白（lum>110）
        alpha = int(max(0, min(1, (lum - 62) / 70.0)) * 255)
        if alpha > 0:
            fp[x, y] = (r, g, b, alpha)

bbox = fg.getbbox()
print("foreground bbox", bbox)

fg_dens = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
for dens, canvas in fg_dens.items():
    d = os.path.join(RES, "mipmap-" + dens)
    os.makedirs(d, exist_ok=True)
    scale = canvas * 0.72 / max(w, h)
    inner = fg.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.paste(inner, ((canvas - inner.width) // 2, (canvas - inner.height) // 2), inner)
    out.save(os.path.join(d, "ic_launcher_foreground.png"), "PNG", optimize=True)
    print("foreground", dens, canvas)

# 3) 背景色 + adaptive 描述
os.makedirs(os.path.join(RES, "values"), exist_ok=True)
with open(os.path.join(RES, "values", "colors.xml"), "w", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FF161512</color>\n</resources>\n')

anydpi = os.path.join(RES, "mipmap-anydpi-v26")
os.makedirs(anydpi, exist_ok=True)
xml = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
"""
for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
    with open(os.path.join(anydpi, name), "w", encoding="utf-8") as f:
        f.write(xml)

print("done")
