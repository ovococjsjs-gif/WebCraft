#!/usr/bin/env python3
"""Builds packages/ui/src/assets.css: the pixel textures and HUD sprites of the 0.10 interface.

Everything is drawn here from code (no downloaded art), so the look can be tuned and rebuilt:
    python3 scripts/ui-assets.py
Textures are tiny PNGs shown with image-rendering: pixelated; sprites are 9x9 SVGs of rects.
"""
import base64, io, random, zlib, struct, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / 'packages/ui/src/assets.css'


def png(width, height, pixels):
    """pixels: list of (r, g, b, a) rows. A minimal PNG writer, no Pillow needed."""
    raw = b''.join(b'\x00' + bytes(v for p in row for v in p) for row in pixels)
    def chunk(kind, data):
        c = struct.pack('>I', len(data)) + kind + data
        return c + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    return 'data:image/png;base64,' + base64.b64encode(data).decode()


def clamp(v):
    return max(0, min(255, int(v)))


def texture(size, base, spread, specks=(), seed=1, alpha=255):
    rnd = random.Random(seed)
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            k = rnd.uniform(-spread, spread)
            r, g, b = (c + k for c in base)
            for chance, delta in specks:
                if rnd.random() < chance:
                    r, g, b = r + delta, g + delta, b + delta
            row.append((clamp(r), clamp(g), clamp(b), alpha))
        rows.append(row)
    return png(size, size, rows)


def stone(seed, base, spread=5):
    # Cobbled blotches like the stone block, but quiet enough to sit behind text.
    rnd = random.Random(seed)
    size = 32
    field = [[0.0] * size for _ in range(size)]
    for _ in range(26):
        cx, cy, r, d = rnd.randrange(size), rnd.randrange(size), rnd.uniform(1.5, 4.5), rnd.uniform(-7, 7)
        for y in range(size):
            for x in range(size):
                dx = min(abs(x - cx), size - abs(x - cx))
                dy = min(abs(y - cy), size - abs(y - cy))
                if dx * dx + dy * dy <= r * r:
                    field[y][x] += d
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            k = field[y][x] + rnd.uniform(-spread, spread)
            row.append(tuple(clamp(c + k) for c in base) + (255,))
        rows.append(row)
    return png(size, size, rows)


def parchment():
    rnd = random.Random(7)
    size = 64
    rows = []
    for y in range(size):
        row = []
        fibre = rnd.uniform(-2, 2)
        for x in range(size):
            k = rnd.uniform(-4, 4) + fibre + (3 if rnd.random() < 0.02 else 0) - (6 if rnd.random() < 0.012 else 0)
            row.append((clamp(233 + k), clamp(218 + k), clamp(182 + k * 0.9), 255))
        rows.append(row)
    return png(size, size, rows)


def sprite(grid, colours):
    """A 9x9 (or any) grid of characters to an SVG data URI of crisp rects."""
    h = len(grid)
    w = max(len(r) for r in grid)
    rects = []
    for y, row in enumerate(grid):
        for x, ch in enumerate(row):
            if ch in colours:
                rects.append(f"<rect x='{x}' y='{y}' width='1.02' height='1.02' fill='{colours[ch]}'/>")
    svg = (f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {w} {h}' shape-rendering='crispEdges'>"
           + ''.join(rects) + '</svg>')
    return "url(\"data:image/svg+xml;utf8," + svg.replace('#', '%23').replace('"', "'") + "\")"


HEART = [
    '.kk...kk.',
    'krrk.krrk',
    'krwrkrrrk',
    'krrrrrrdk',
    'krrrrrrdk',
    '.krrrrdk.',
    '..krrdk..',
    '...kdk...',
    '....k....',
]
HEART_HALF = [
    '.kk...kk.',
    'krrk.keek',
    'krwrkeeek',
    'krrrkeeek',
    'krrrkeeek',
    '.krrkeek.',
    '..krkek..',
    '...kek...',
    '....k....',
]
FOOD = [
    '.....kkk.',
    '....kbwbk',
    '...kbbbbk',
    '..kbbbbbk',
    '..kbbbbk.',
    '.kbbbdk..',
    'kwkkkk...',
    'kwk......',
    '.k.......',
]
FOOD_HALF = [
    '.....kkk.',
    '....keeek',
    '...keeeek',
    '..kbeeeek',
    '..kbbeek.',
    '.kbbbdk..',
    'kwkkkk...',
    'kwk......',
    '.k.......',
]
ARMOR = [
    'kk.....kk',
    'kgk...kgk',
    'kgwkkkggk',
    'kgwggggsk',
    '.kgggggk.',
    '.kgggggk.',
    '.kggggsk.',
    '.kggggsk.',
    '.kkkkkkk.',
]
BUBBLE = [
    '..kkkkk..',
    '.kbbbbbk.',
    'kbwwbbbbk',
    'kbwbbbbbk',
    'kbbbbbbbk',
    'kbbbbbbdk',
    'kbbbbbbdk',
    '.kbbbddk.',
    '..kkkkk..',
]
XP_ORB = [
    '..kkk..',
    '.kgggk.',
    'kgwggdk',
    'kggggdk',
    'kgggddk',
    '.kgddk.',
    '..kkk..',
]
CORNER = [  # journal page corner ornament
    'iiiiiii.',
    'i.......',
    'i.iii...',
    'i.i.....',
    'i.i.....',
    'i.......',
    'i.......',
    '........',
]


def main():
    ink = '#2b1f14'
    empty = 'rgba(20,12,10,0.55)'
    red = {'k': ink, 'r': '#d8352e', 'w': '#ff9d8c', 'd': '#8f1c18'}
    red_empty = {'k': ink, 'r': empty, 'w': empty, 'd': empty}
    gold = {'k': ink, 'r': '#e7b53c', 'w': '#fff0a8', 'd': '#a8741c'}
    half = dict(red, e=empty)
    meat = {'k': ink, 'b': '#b8672f', 'w': '#f3e8d2', 'd': '#7c3e1a'}
    meat_empty = {'k': ink, 'b': empty, 'w': empty, 'd': empty}
    meat_half = dict(meat, e=empty)
    iron = {'k': ink, 'g': '#c9ccce', 'w': '#ffffff', 's': '#8a8f93'}
    iron_empty = {'k': ink, 'g': empty, 'w': empty, 's': empty}
    water = {'k': '#123a5a', 'b': '#4aa6e6', 'w': '#dff4ff', 'd': '#2a74b2'}
    water_empty = {'k': 'rgba(18,58,90,0.35)'}
    orb = {'k': '#1e3a0c', 'g': '#8fe04a', 'w': '#f2ffc0', 'd': '#4f9a1e'}

    css = ['/* Generated by scripts/ui-assets.py — do not edit by hand. */', ':root {']
    css.append(f"  --tex-stone: url({stone(3, (58, 55, 52))});")
    css.append(f"  --tex-stone-dark: url({stone(5, (36, 34, 32), 4)});")
    css.append(f"  --tex-stone-light: url({stone(9, (112, 108, 102), 6)});")
    css.append(f"  --tex-parchment: url({parchment()});")
    css.append(f"  --tex-leather: url({texture(32, (92, 58, 36), 6, ((0.05, -14),), seed=11)});")
    css.append(f"  --tex-dirt: url({texture(16, (110, 78, 52), 12, ((0.08, -18), (0.05, 16)), seed=13)});")
    css.append(f"  --spr-heart: {sprite(HEART, red)};")
    css.append(f"  --spr-heart-half: {sprite(HEART_HALF, half)};")
    css.append(f"  --spr-heart-empty: {sprite(HEART, red_empty)};")
    css.append(f"  --spr-heart-gold: {sprite(HEART, gold)};")
    css.append(f"  --spr-food: {sprite(FOOD, meat)};")
    css.append(f"  --spr-food-half: {sprite(FOOD_HALF, meat_half)};")
    css.append(f"  --spr-food-empty: {sprite(FOOD, meat_empty)};")
    css.append(f"  --spr-armor: {sprite(ARMOR, iron)};")
    css.append(f"  --spr-armor-empty: {sprite(ARMOR, iron_empty)};")
    css.append(f"  --spr-bubble: {sprite(BUBBLE, water)};")
    css.append(f"  --spr-bubble-empty: {sprite(BUBBLE, water_empty)};")
    css.append(f"  --spr-orb: {sprite(XP_ORB, orb)};")
    css.append(f"  --spr-corner: {sprite(CORNER, {'i': '#6b4f2e'})};")
    css.append('}')
    OUT.write_text('\n'.join(css) + '\n')
    print('wrote', OUT, OUT.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
