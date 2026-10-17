"""Draws the room photographs the live proofs file.

They are rendered, not photographed, and say so: a flat's walls and fittings
drawn plainly enough that a vision model can describe them, with the one
difference each case turns on. Re-running this script reproduces the same
bytes (fixed seeds), so the digests in the proof logs stay checkable.

    python fixtures/make_photos.py
"""
import pathlib
import random

from PIL import Image, ImageDraw, ImageFilter

OUT = pathlib.Path(__file__).resolve().parent / "photos"
W, H = 1024, 768


def grain(img: Image.Image, seed: int, amount: int = 10) -> Image.Image:
    rnd = random.Random(seed)
    px = img.load()
    for _ in range(W * H // 6):
        x, y = rnd.randrange(W), rnd.randrange(H)
        r, g, b = px[x, y]
        d = rnd.randint(-amount, amount)
        px[x, y] = (max(0, min(255, r + d)), max(0, min(255, g + d)), max(0, min(255, b + d)))
    return img


def living_wall(seed: int, damage: bool) -> Image.Image:
    img = Image.new("RGB", (W, H), (226, 214, 190))
    d = ImageDraw.Draw(img)
    # floorboards
    d.rectangle([0, 600, W, H], fill=(150, 104, 66))
    for x in range(0, W, 128):
        d.line([x, 600, x, H], fill=(120, 80, 48), width=3)
    # skirting board
    d.rectangle([0, 570, W, 604], fill=(244, 242, 236))
    d.line([0, 570, W, 570], fill=(200, 196, 188), width=2)
    # light switch
    d.rounded_rectangle([780, 300, 840, 380], radius=6, fill=(250, 250, 248), outline=(190, 186, 180), width=2)
    d.rounded_rectangle([800, 318, 820, 362], radius=3, fill=(236, 234, 230), outline=(180, 176, 170))
    # a framed picture
    d.rectangle([160, 140, 420, 330], fill=(92, 70, 52))
    d.rectangle([176, 156, 404, 314], fill=(170, 196, 214))
    d.polygon([(176, 314), (260, 220), (330, 280), (404, 200), (404, 314)], fill=(96, 132, 92))
    img = grain(img, seed)
    if damage:
        d = ImageDraw.Draw(img)
        # three holes punched in the plaster, with crumbled edges
        for cx, cy, r in ((520, 360, 16), (585, 392, 12), (548, 446, 18)):
            d.ellipse([cx - r - 6, cy - r - 6, cx + r + 6, cy + r + 6], fill=(205, 194, 172))
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(48, 40, 34))
            d.arc([cx - r - 6, cy - r - 6, cx + r + 6, cy + r + 6], 200, 340, fill=(120, 108, 96), width=3)
        # a large dark scorch-like stain spreading down the wall
        stain = Image.new("L", (W, H), 0)
        sd = ImageDraw.Draw(stain)
        sd.ellipse([250, 400, 470, 560], fill=170)
        sd.ellipse([300, 360, 420, 470], fill=140)
        stain = stain.filter(ImageFilter.GaussianBlur(18))
        brown = Image.new("RGB", (W, H), (96, 62, 30))
        img = Image.composite(brown, img, stain)
        d = ImageDraw.Draw(img)
        # a crack running up from the holes
        d.line([(548, 446), (560, 500), (552, 540), (566, 570)], fill=(70, 60, 50), width=3)
    return img


def sink(seed: int, chip: bool) -> Image.Image:
    img = Image.new("RGB", (W, H), (214, 226, 230))
    d = ImageDraw.Draw(img)
    # wall tiles
    for x in range(0, W, 96):
        d.line([x, 0, x, H], fill=(186, 200, 206), width=3)
    for y in range(0, H, 96):
        d.line([0, y, W, y], fill=(186, 200, 206), width=3)
    # the basin
    d.rounded_rectangle([212, 300, 812, 560], radius=60, fill=(250, 250, 250), outline=(196, 196, 196), width=4)
    d.ellipse([302, 340, 722, 520], fill=(236, 238, 240), outline=(200, 202, 206), width=3)
    d.ellipse([500, 420, 524, 440], fill=(150, 150, 150))
    # tap
    d.rectangle([494, 220, 530, 330], fill=(190, 196, 202))
    d.rectangle([470, 300, 560, 330], fill=(206, 212, 218))
    d.rectangle([506, 330, 520, 372], fill=(170, 176, 182))
    img = grain(img, seed, 6)
    if chip:
        d = ImageDraw.Draw(img)
        # a chip out of the front rim, with a grey crack running from it
        d.polygon([(640, 548), (676, 560), (668, 566), (630, 562)], fill=(120, 116, 110))
        d.line([(652, 548), (640, 520), (646, 500)], fill=(110, 110, 110), width=2)
    return img


def cupboard(seed: int, scuffs: bool) -> Image.Image:
    img = Image.new("RGB", (W, H), (238, 236, 230))
    d = ImageDraw.Draw(img)
    d.rectangle([180, 120, 500, 680], fill=(214, 196, 164), outline=(160, 140, 110), width=4)
    d.rectangle([524, 120, 844, 680], fill=(214, 196, 164), outline=(160, 140, 110), width=4)
    d.rounded_rectangle([462, 380, 476, 470], radius=6, fill=(120, 120, 124))
    d.rounded_rectangle([548, 380, 562, 470], radius=6, fill=(120, 120, 124))
    d.rectangle([140, 690, 884, 720], fill=(90, 86, 82))
    img = grain(img, seed, 6)
    if scuffs:
        d = ImageDraw.Draw(img)
        rnd = random.Random(seed + 1)
        for _ in range(14):
            x, y = rnd.randint(420, 600), rnd.randint(360, 500)
            d.line([(x, y), (x + rnd.randint(8, 22), y + rnd.randint(-3, 3))], fill=(186, 170, 140), width=2)
    return img


def save(img: Image.Image, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Pillow writes a JFIF header for JPEG, which is what the runtime reads.
    img.save(OUT / name, "JPEG", quality=84, optimize=True)
    data = (OUT / name).read_bytes()
    assert data[:4] == b"\xff\xd8\xff\xe0" and len(data) < 400_000, name


if __name__ == "__main__":
    save(living_wall(11, damage=False), "living-wall-move-in.jpg")
    save(living_wall(12, damage=True), "living-wall-move-out.jpg")
    save(sink(21, chip=False), "bathroom-sink-landlord-move-in.jpg")
    save(sink(22, chip=True), "bathroom-sink-tenant-move-in.jpg")
    save(sink(23, chip=True), "bathroom-sink-move-out.jpg")
    save(cupboard(31, scuffs=False), "kitchen-cupboard-move-in.jpg")
    save(cupboard(32, scuffs=True), "kitchen-cupboard-move-out.jpg")
    for p in sorted(OUT.glob("*.jpg")):
        print(f"{p.name:40s} {p.stat().st_size:>7,} bytes")
