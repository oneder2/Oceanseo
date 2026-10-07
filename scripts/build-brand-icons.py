"""Derive platform assets from the API-generated master; no network access.

Run: uv run --with pillow python scripts/build-brand-icons.py
The transparent master and original API image live in assets/branding.
"""
from pathlib import Path
from math import hypot
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "src-tauri/gen/android/app/src/main/res"
PAPER = "#E7EEE5"
MASTER = Image.open(ROOT / "assets/branding/tideplan-hedgehog.png").convert("RGBA")
bounds = MASTER.getchannel("A").point(lambda a: 255 if a > 32 else 0).getbbox()
if not bounds:
    raise ValueError("Master contains no visible mark")
MARK = MASTER.crop(bounds)


def save(image, path):
    path = ROOT / path
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)


def centered(size, fraction=0.86, monochrome=False):
    mark = MARK.copy()
    if monochrome:
        solid = Image.new("RGBA", mark.size, "white")
        solid.putalpha(mark.getchannel("A"))
        mark = solid
    mark.thumbnail((round(size * fraction), round(size * fraction)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size))
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas


def tile(size, circular=False):
    canvas = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(canvas)
    if circular:
        draw.ellipse((0, 0, size - 1, size - 1), fill=PAPER)
    else:
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=size * 0.22, fill=PAPER)
    canvas.alpha_composite(centered(size, 0.82))
    return canvas


# Desktop launchers and tray use the same high-contrast, lightly framed mark.
icon = tile(1024)
for name, size in [("icon.png", 512), ("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256)]:
    save(icon.resize((size, size), Image.Resampling.LANCZOS), f"src-tauri/icons/{name}")
save(icon, "assets/branding/tideplan-app-icon.png")
save(icon.resize((64, 64), Image.Resampling.LANCZOS), "public/favicon.png")
save(centered(192, 0.96), "public/brand/hedgehog.png")

# Foreground is deliberately unframed. Android supplies the background and mask.
# Every visible foreground pixel must be inside the 66/108 safe-zone circle.
foreground = centered(1024, 0.58)
mask = foreground.getchannel("A")
radius = max(hypot(x - 511.5, y - 511.5) for y in range(1024) for x in range(1024) if mask.getpixel((x, y)) > 16)
assert radius < 1024 * 33 / 108, "Adaptive icon exceeds the safe circle"
for density, scale in [("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)]:
    mipmap = RES / f"mipmap-{density}"
    adaptive_size = round(108 * scale)
    save(foreground.resize((adaptive_size, adaptive_size), Image.Resampling.LANCZOS), mipmap / "ic_launcher_foreground.png")
    save(centered(adaptive_size, 0.58, True), mipmap / "ic_launcher_monochrome.png")
    save(tile(round(48 * scale)), mipmap / "ic_launcher.png")
    save(tile(round(48 * scale), circular=True), mipmap / "ic_launcher_round.png")
    save(centered(round(24 * scale), 0.92, True), RES / f"drawable-{density}/ic_notification.png")

# Reviewer contact sheet: actual small sizes on both light and dark surfaces,
# plus circular / rounded Android masks. This is a generated review artifact.
sheet = Image.new("RGB", (1000, 620), "#FAF8F4")
draw = ImageDraw.Draw(sheet)
font = ImageFont.load_default(size=20)
for row, bg in enumerate(["#FAF8F4", "#263B33"]):
    y = row * 160
    draw.rectangle((0, y, 999, y + 159), fill=bg)
    for col, size in enumerate([16, 24, 32, 48, 64, 96]):
        x = 35 + col * 155
        draw.text((x, y + 10), f"{size}px", font=font, fill="#719482")
        sample = icon.resize((size, size), Image.Resampling.LANCZOS)
        sheet.paste(sample, (x, y + 48), sample)
for col, circle in enumerate([False, True]):
    size = 240
    adaptive = Image.new("RGBA", (size, size), PAPER)
    fg = foreground.resize((360, 360), Image.Resampling.LANCZOS).crop((60, 60, 300, 300))
    adaptive.alpha_composite(fg)
    crop = Image.new("L", (size, size))
    pen = ImageDraw.Draw(crop)
    if circle:
        pen.ellipse((0, 0, 239, 239), fill=255)
    else:
        pen.rounded_rectangle((0, 0, 239, 239), radius=54, fill=255)
    adaptive.putalpha(crop)
    sheet.paste(adaptive, (40 + col * 310, 350), adaptive)
mono = centered(180, 0.9, True)
sheet.paste(Image.new("RGB", (220, 240), "#285F50"), (710, 350))
sheet.paste(mono, (730, 380), mono)
save(sheet, "output/imagegen/icon-size-and-mask-review.png")
print(f"Platform icons generated. Adaptive safe radius: {radius:.1f}/312.9 px")
