"""Derive public product media from isolated, synthetic UI captures."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

target = Path('landing/public/media')
target.mkdir(parents=True, exist_ok=True)
images = {}
for kind in ('chat', 'delivery', 'calendar'):
    image = Image.open(f'output/playwright/landing-app-{kind}.png').convert('RGB')
    image.save(target / f'app-{kind}.webp', quality=90)
    images[kind] = image
mascot = Image.open('assets/branding/tideplan-hedgehog.png').convert('RGBA')
mascot.thumbnail((256, 256), Image.Resampling.LANCZOS)
mascot.save(target / 'mascot.webp', quality=95)
Image.open('public/favicon.png').save('landing/public/favicon.png')

def phone(canvas, kind, x, y, width):
    height = round(width * 844 / 390)
    shadow = Image.new('RGBA', canvas.size)
    ImageDraw.Draw(shadow).rounded_rectangle((x-4, y+6, x+width+4, y+height+12), radius=12, fill=(21,61,58,32))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    frame = ImageDraw.Draw(canvas)
    frame.rounded_rectangle((x-4, y-4, x+width+4, y+height+4), radius=12, fill='#153d3a')
    canvas.paste(images[kind].resize((width, height), Image.Resampling.LANCZOS), (x,y))

# Real product screens are the hero's media, not decorative abstract graphics.
desktop = Image.new('RGBA', (1920,960), '#f1f7f5')
phone(desktop, 'chat', 342, 525, 200)
phone(desktop, 'delivery', 860, 545, 200)
phone(desktop, 'calendar', 1378, 525, 200)
desktop.convert('RGB').save(target / 'hero-desktop.webp', quality=90)
mobile = Image.new('RGBA', (780,1360), '#f1f7f5')
phone(mobile, 'chat', 112, 800, 255)
phone(mobile, 'calendar', 414, 834, 255)
mobile.convert('RGB').save(target / 'hero-mobile.webp', quality=90)
print('Public media derived from synthetic screenshots.')
