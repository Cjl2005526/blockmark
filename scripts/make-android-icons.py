from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"
SRC = ROOT / "icons" / "icon-512.png"

LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def draw_foreground(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    inner = size * 0.62
    left = (size - inner) / 2
    top = (size - inner) / 2
    s = inner
    stroke = max(2, int(size * 0.012))

    red = (255, 59, 48, 255)
    blue = (10, 132, 255, 255)
    green = (52, 199, 89, 255)
    alpha = 235

    draw.rounded_rectangle(
        [left + s * 0.02, top + s * 0.08, left + s * 0.44, top + s * 0.56],
        radius=int(s * 0.06),
        fill=(*red[:3], alpha),
        outline=red,
        width=stroke,
    )
    draw.ellipse(
        [left + s * 0.54, top + s * 0.04, left + s * 0.98, top + s * 0.48],
        fill=(*blue[:3], alpha),
        outline=blue,
        width=stroke,
    )
    triangle = [
        (left + s * 0.5, top + s * 0.6),
        (left + s * 0.82, top + s * 0.98),
        (left + s * 0.18, top + s * 0.98),
    ]
    draw.polygon(triangle, fill=(*green[:3], alpha))
    draw.line(triangle + [triangle[0]], fill=green, width=stroke, joint="curve")
    return img


source = Image.open(SRC).convert("RGBA")
for density, size in LEGACY.items():
    icon = source.resize((size, size), Image.LANCZOS)
    folder = RES / f"mipmap-{density}"
    icon.save(folder / "ic_launcher.png")
    icon.save(folder / "ic_launcher_round.png")

for density, size in FOREGROUND.items():
    draw_foreground(size).save(RES / f"mipmap-{density}" / "ic_launcher_foreground.png")

background = RES / "values" / "ic_launcher_background.xml"
background.write_text(
    background.read_text(encoding="utf-8").replace("#FFFFFF", "#111112"),
    encoding="utf-8",
)

print("android launcher icons updated")
