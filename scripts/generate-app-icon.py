#!/usr/bin/env python3
"""Generate Music Box PNG/ICO assets using only the Python standard library."""

import math
import os
import struct
import sys
import zlib

SIZE = 1024


def rounded_box(x, y, left, top, right, bottom, radius):
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def polygon(x, y, points):
    inside = False
    j = len(points) - 1
    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def gradient(x, y):
    stops = [
        (0.00, (22, 219, 255)),
        (0.34, (112, 84, 255)),
        (0.60, (218, 42, 222)),
        (0.82, (255, 82, 113)),
        (1.00, (255, 166, 45)),
    ]
    t = max(0.0, min(1.0, (x * 0.58 + y * 0.42 - 220) / 630))
    for index in range(len(stops) - 1):
        a, ca = stops[index]
        b, cb = stops[index + 1]
        if t <= b:
            f = (t - a) / (b - a)
            return tuple(int(ca[k] + (cb[k] - ca[k]) * f) for k in range(3))
    return stops[-1][1]


def pixel(x, y):
    # Soft near-black rounded-square tile.
    if not rounded_box(x, y, 36, 36, 988, 988, 205):
        return 0, 0, 0, 0
    distance = math.hypot(x - 512, y - 500) / 720
    base = max(7, int(16 - distance * 7))
    bg = (base, base, base + 10, 255)

    # Speaker body, note stem, beam and note head.
    speaker = polygon(x, y, [(238, 730), (304, 505), (535, 458), (569, 790), (270, 790)])
    stem = rounded_box(x, y, 570, 194, 762, 749, 56)
    beam = polygon(x, y, [(408, 260), (710, 190), (746, 190), (715, 355), (392, 431)])
    head = ((x - 520) / 126) ** 2 + ((y - 696) / 92) ** 2 <= 1
    shape = speaker or stem or beam or head

    # Speaker cone cuts into the speaker body.
    cone = math.hypot(x - 408, y - 660)
    if speaker and cone < 79:
        if cone > 57:
            r, g, b = gradient(x + 100, y)
            return r, g, b, 255
        return 8, 9, 18, 255

    if shape:
        r, g, b = gradient(x, y)
        # Gentle glass highlight from the upper-left.
        highlight = max(0.0, 1.0 - math.hypot(x - 350, y - 270) / 430) * 54
        return min(255, int(r + highlight)), min(255, int(g + highlight)), min(255, int(b + highlight)), 255

    return bg


def png_bytes():
    rows = bytearray()
    for y in range(SIZE):
        rows.append(0)
        for x in range(SIZE):
            rows.extend(pixel(x, y))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )


def main():
    output = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "host-gui/assets")
    os.makedirs(output, exist_ok=True)
    png = png_bytes()
    png_path = os.path.join(output, "app-icon.png")
    with open(png_path, "wb") as handle:
        handle.write(png)

    # Modern Windows accepts a PNG-compressed 256px+ image inside ICO.
    ico = struct.pack("<HHH", 0, 1, 1)
    ico += struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png), 22)
    ico += png
    with open(os.path.join(output, "app-icon.ico"), "wb") as handle:
        handle.write(ico)

    print(png_path)


if __name__ == "__main__":
    main()
