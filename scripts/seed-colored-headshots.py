#!/usr/bin/env python3
"""Generate solid colored circle PNGs for temporary dogfood headshots."""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw

# Distinct hues — enough for 150 speakers with wrap
PALETTE = [
    (79, 70, 229),  # indigo
    (13, 148, 136),  # teal
    (217, 119, 6),  # amber
    (220, 38, 38),  # red
    (147, 51, 234),  # purple
    (22, 163, 74),  # green
    (2, 132, 199),  # sky
    (234, 88, 12),  # orange
    (190, 24, 93),  # rose
    (71, 85, 105),  # slate
]


def circle_png(path: str, rgb: tuple[int, int, int], size: int = 96) -> None:
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    pad = 2
    draw.ellipse([pad, pad, size - pad - 1, size - pad - 1], fill=(*rgb, 255))
    im.save(path, format="PNG")


def main() -> int:
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/speakerops-headshots"
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 150
    os.makedirs(out_dir, exist_ok=True)
    for i in range(count):
        rgb = PALETTE[i % len(PALETTE)]
        # slight channel drift so neighbors differ
        r = min(255, rgb[0] + (i * 3) % 40)
        g = min(255, rgb[1] + (i * 5) % 35)
        b = min(255, rgb[2] + (i * 7) % 45)
        path = os.path.join(out_dir, f"headshot_{i:03d}.png")
        circle_png(path, (r, g, b))
    print(out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
