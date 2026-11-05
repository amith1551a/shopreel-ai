"""Draw a synthetic product illustration. No real brand or product claim."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from PIL import Image, ImageDraw
from video_engine import font


def main():
    image = Image.new('RGB', (800, 900), '#F3EBDE')
    draw = ImageDraw.Draw(image)
    draw.ellipse((180, 750, 650, 825), fill='#DFD1BC')
    draw.rounded_rectangle((275, 170, 525, 765), radius=55, fill='#C95B37')
    draw.rounded_rectangle((320, 115, 480, 220), radius=12, fill='#263C2F')
    draw.rounded_rectangle((330, 75, 540, 120), radius=10, fill='#263C2F')
    draw.rectangle((475, 95, 540, 135), fill='#263C2F')
    draw.text((315, 340), 'everyday', fill='#F6E7C9', font=font(35))
    draw.text((307, 390), 'essentials.', fill='#F6E7C9', font=font(34, True))
    draw.line((315, 470, 485, 470), fill='#E9C5AA', width=2)
    draw.text((317, 510), 'HAND WASH', fill='#F6E7C9', font=font(20, True))
    draw.text((319, 550), 'SAMPLE PRODUCT', fill='#F6E7C9', font=font(16))
    draw.text((347, 690), '250 mL', fill='#F6E7C9', font=font(20))
    image.save(ROOT / 'static' / 'demo-product.png')
    print('Synthetic sample product ready.')


if __name__ == '__main__':
    main()
