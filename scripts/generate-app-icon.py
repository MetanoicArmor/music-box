#!/usr/bin/env python3
"""Generate Music Box PNG/ICO and Android launcher assets (stdlib only)."""

import math
import os
import struct
import sys
import zlib

MASTER = 1024
ANDROID_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
ADAPTIVE_FG = 432


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
    if not rounded_box(x, y, 36, 36, 988, 988, 205):
        return 0, 0, 0, 0
    distance = math.hypot(x - 512, y - 500) / 720
    base = max(7, int(16 - distance * 7))
    bg = (base, base, base + 10, 255)

    speaker = polygon(x, y, [(238, 730), (304, 505), (535, 458), (569, 790), (270, 790)])
    stem = rounded_box(x, y, 570, 194, 762, 749, 56)
    beam = polygon(x, y, [(408, 260), (710, 190), (746, 190), (715, 355), (392, 431)])
    head = ((x - 520) / 126) ** 2 + ((y - 696) / 92) ** 2 <= 1
    shape = speaker or stem or beam or head

    cone = math.hypot(x - 408, y - 660)
    if speaker and cone < 79:
        if cone > 57:
            r, g, b = gradient(x + 100, y)
            return r, g, b, 255
        return 8, 9, 18, 255

    if shape:
        r, g, b = gradient(x, y)
        highlight = max(0.0, 1.0 - math.hypot(x - 350, y - 270) / 430) * 54
        return min(255, int(r + highlight)), min(255, int(g + highlight)), min(255, int(b + highlight)), 255

    return bg


def render_master():
    pixels = [None] * (MASTER * MASTER)
    for y in range(MASTER):
        row = y * MASTER
        for x in range(MASTER):
            pixels[row + x] = pixel(x, y)
    return pixels


def sample(master, size, x, y, opaque):
    sx = (x + 0.5) * MASTER / size - 0.5
    sy = (y + 0.5) * MASTER / size - 0.5
    x0 = int(math.floor(sx))
    y0 = int(math.floor(sy))
    fx = sx - x0
    fy = sy - y0
    samples = []
    for oy in (0, 1):
        for ox in (0, 1):
            px = min(MASTER - 1, max(0, x0 + ox))
            py = min(MASTER - 1, max(0, y0 + oy))
            samples.append(master[py * MASTER + px])
    weights = ((1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy)
    rgba = [int(round(sum(samples[i][c] * weights[i] for i in range(4)))) for c in range(4)]
    if opaque and rgba[3] < 255:
        a = rgba[3] / 255.0
        back = (10, 10, 18)
        rgba = [int(round(rgba[i] * a + back[i] * (1 - a))) for i in range(3)] + [255]
    return rgba


def encode_png(master, size=MASTER, opaque=False):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            if size == MASTER:
                color = list(master[y * MASTER + x])
                if opaque and color[3] < 255:
                    a = color[3] / 255.0
                    back = (10, 10, 18)
                    color = [int(round(color[i] * a + back[i] * (1 - a))) for i in range(3)] + [255]
                rows.extend(color)
            else:
                rows.extend(sample(master, size, x, y, opaque))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )


def write_png(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)
    return path


def write_ico(path, png):
    ico = struct.pack("<HHH", 0, 1, 1)
    ico += struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png), 22)
    ico += png
    with open(path, "wb") as handle:
        handle.write(ico)


def write_android(root, master):
    res = os.path.join(root, "android", "app", "src", "main", "res")
    written = []
    for folder, size in ANDROID_SIZES.items():
        directory = os.path.join(res, folder)
        data = encode_png(master, size, opaque=True)
        for name in ("ic_launcher.png", "ic_launcher_round.png"):
            written.append(write_png(os.path.join(directory, name), data))

    drawable = os.path.join(res, "drawable")
    written.append(
        write_png(os.path.join(drawable, "ic_launcher_foreground.png"), encode_png(master, ADAPTIVE_FG, opaque=True))
    )
    with open(os.path.join(drawable, "ic_launcher_background.xml"), "w", encoding="utf-8") as handle:
        handle.write(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<shape xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <solid android:color="#0A0A12" />\n'
            "</shape>\n"
        )
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        path = os.path.join(res, "mipmap-anydpi-v26", name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(
                '<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@drawable/ic_launcher_background" />\n'
                '    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
                "</adaptive-icon>\n"
            )
        written.append(path)

    old_vector = os.path.join(drawable, "ic_launcher_foreground.xml")
    if os.path.exists(old_vector):
        os.remove(old_vector)
    return written


def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    output = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "host-gui", "assets"))
    os.makedirs(output, exist_ok=True)

    master = render_master()
    master_png = encode_png(master, MASTER, opaque=False)
    png_path = os.path.join(output, "app-icon.png")
    write_png(png_path, master_png)
    write_ico(os.path.join(output, "app-icon.ico"), master_png)

    android_paths = write_android(root, master)
    print(png_path)
    for path in android_paths:
        print(path)


if __name__ == "__main__":
    main()
