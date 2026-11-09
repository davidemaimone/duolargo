#!/usr/bin/env python3
"""Affianca "prima" e "dopo" con una colonna di comandi di Safari finta disegnata sopra."""
import json, sys, pathlib
from PIL import Image, ImageDraw, ImageFont

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parent / "out")
S = 2  # pixel per punto
W, STRIP, H = 466, 84, 678
res = json.loads((out / "risultati.json").read_text())
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
    small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
except Exception:
    font = small = ImageFont.load_default()

def parse_rgb(css):
    try:
        nums = [int(float(x)) for x in css[css.index("(") + 1 : css.index(")")].split(",")[:3]]
        return tuple(nums)
    except Exception:
        return (242, 242, 247)

def safari_controls(img):
    d = ImageDraw.Draw(img, "RGBA")
    cx = 418 * S
    glass = (170, 170, 176, 150)
    edge = (255, 255, 255, 200)
    for cy in (243, 302):
        r = 24 * S
        d.ellipse([cx - r, cy * S - r, cx + r, cy * S + r], fill=glass, outline=edge, width=2)
    d.rounded_rectangle([394 * S, 543 * S, 442 * S, 643 * S], radius=24 * S, fill=glass, outline=edge, width=2)
    d.text((cx, 133 * S), "9:41", fill=(20, 20, 20, 255), font=font, anchor="mm")
    # barra degli indirizzi
    d.rounded_rectangle([24 * S, 597 * S, 358 * S, 643 * S], radius=23 * S, fill=glass, outline=edge, width=2)
    d.text((191 * S, 620 * S), "sito.it", fill=(255, 255, 255, 255), font=small, anchor="mm")
    # bordo della pagina normale
    for y in range(0, H * S, 16):
        d.line([(382 * S, y), (382 * S, y + 8)], fill=(255, 0, 0, 160), width=2)

for name, r in res.items():
    before = Image.open(out / f"{name}-prima.png").convert("RGB")
    after = Image.open(out / f"{name}-dopo.png").convert("RGB")
    a = Image.new("RGB", (W * S, H * S), parse_rgb(r.get("sfondo", "")))
    a.paste(before, (0, 0))
    safari_controls(a)
    b = after.copy()
    safari_controls(b)
    gap, top = 30, 60
    sheet = Image.new("RGB", (W * S * 2 + gap * 3, H * S + top + gap), (40, 40, 44))
    sheet.paste(a, (gap, top))
    sheet.paste(b, (W * S + gap * 2, top))
    d = ImageDraw.Draw(sheet)
    d.text((gap, 15), f"{name}: Safari normale", fill="white", font=font)
    ok = not r["sottoLaColonna"] and not r["troppoStretti"] and not r["errori"] and r["scrollWidth"] <= W + 1
    d.text((W * S + gap * 2, 15), f"con DuoLargo  {'OK' if ok else 'PROBLEMI'}", fill=(120, 230, 140) if ok else (255, 120, 110), font=font)
    sheet.save(out / f"{name}-confronto.png")
    print(name, "OK" if ok else "PROBLEMI")
