"""Generate PWA icons for Plant Analytics Portal."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

BG = (23, 37, 42)       # #17252a - dark teal
FG = (58, 175, 169)     # #3aafa9 - accent teal
TEXT = "PA"

PUBLIC = Path(__file__).resolve().parent.parent / "public"
PUBLIC.mkdir(parents=True, exist_ok=True)


def load_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render(size: int, out: Path) -> None:
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)
    font = load_font(int(size * 0.55))
    bbox = draw.textbbox((0, 0), TEXT, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) // 2 - bbox[0]
    y = (size - th) // 2 - bbox[1]
    draw.text((x, y), TEXT, fill=FG, font=font)
    img.save(out, "PNG", optimize=True)
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    render(192, PUBLIC / "icon-192.png")
    render(512, PUBLIC / "icon-512.png")
