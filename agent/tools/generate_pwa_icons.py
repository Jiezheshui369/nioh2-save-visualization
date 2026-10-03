"""Generate deterministic PWA raster icons from the project's vector art direction."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).parents[2]
PUBLIC = ROOT / "public"
FONT_CANDIDATES = (
    Path("C:/Windows/Fonts/msyhbd.ttc"),
    Path("C:/Windows/Fonts/simhei.ttf"),
)


def font_for(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in FONT_CANDIDATES:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


def create_icon(size: int, output: Path) -> None:
    scale = size / 512
    image = Image.new("RGB", (size, size), "#090a0a")
    draw = ImageDraw.Draw(image)

    def box(values: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
        return tuple(round(value * scale) for value in values)

    draw.ellipse(box((78, 78, 434, 434)), outline="#b73322", width=max(2, round(18 * scale)))
    draw.ellipse(box((111, 111, 401, 401)), outline="#8f7b4b", width=max(1, round(3 * scale)))
    draw.polygon(
        [(round(x * scale), round(y * scale)) for x, y in ((128, 118), (256, 137), (384, 118), (370, 256), (384, 394), (256, 375), (128, 394), (142, 256))],
        fill="#151918",
        outline="#bda263",
    )
    text = "仁"
    font = font_for(round(218 * scale))
    text_box = draw.textbbox((0, 0), text, font=font)
    x = (size - (text_box[2] - text_box[0])) / 2
    y = round(215 * scale) - (text_box[3] - text_box[1]) / 2 - text_box[1]
    draw.text((x, y), text, font=font, fill="#e8e0ce")
    draw.ellipse(box((330, 326, 418, 414)), fill="#b73322")
    line_width = max(2, round(10 * scale))
    draw.line((round(350 * scale), round(370 * scale), round(398 * scale), round(370 * scale)), fill="#e8e0ce", width=line_width)
    draw.line((round(374 * scale), round(346 * scale), round(374 * scale), round(394 * scale)), fill="#e8e0ce", width=line_width)
    image.save(output, "PNG", optimize=True)


if __name__ == "__main__":
    for icon_size, filename in ((180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")):
        create_icon(icon_size, PUBLIC / filename)
    temporary = PUBLIC / ".icon-256.png"
    create_icon(256, temporary)
    with Image.open(temporary) as icon_source:
        icon_source.save(PUBLIC / "app.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    temporary.unlink()
