from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)


def icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        [0, 0, size - 1, size - 1],
        radius=int(size * 0.22),
        fill=(17, 17, 18, 255),
    )

    width = max(2, int(size * 0.014))
    red = (255, 59, 48, 255)
    blue = (10, 132, 255, 255)
    green = (52, 199, 89, 255)
    alpha = 150

    draw.rounded_rectangle(
        [size * 0.15, size * 0.17, size * 0.46, size * 0.48],
        radius=int(size * 0.035),
        fill=(*red[:3], alpha),
        outline=red,
        width=width,
    )
    draw.ellipse(
        [size * 0.54, size * 0.14, size * 0.85, size * 0.45],
        fill=(*blue[:3], alpha),
        outline=blue,
        width=width,
    )
    triangle = [
        (size * 0.5, size * 0.55),
        (size * 0.73, size * 0.87),
        (size * 0.27, size * 0.87),
    ]
    draw.polygon(triangle, fill=(*green[:3], alpha))
    draw.line(triangle + [triangle[0]], fill=green, width=width, joint="curve")
    return img


for pixels, filename in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    icon(pixels).save(OUT / filename)
    print("wrote", OUT / filename)
