from pathlib import Path

from PIL import Image, ImageDraw


def main() -> int:
    output_path = Path(__file__).resolve().parents[1] / "assets" / "icon.ico"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    image = Image.new("RGBA", (256, 256), (248, 250, 252, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((32, 32, 224, 224), radius=44, fill=(37, 99, 235, 255))
    draw.polygon([(108, 82), (108, 174), (180, 128)], fill=(255, 255, 255, 255))
    image.save(output_path, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])
    print(f"Created {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
