#!/usr/bin/env python3
"""
CC Manager icon generator.
Source: ../icon.svg (rendered via macOS qlmanage)
Output: src-tauri/icons/ — macOS squircle-masked PNGs + .icns + .ico

Usage:
    python3 generate_icons.py
"""

import os, subprocess, tempfile, math
from PIL import Image, ImageDraw, ImageFilter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SVG_SRC    = os.path.join(SCRIPT_DIR, "..", "icon.svg")
ICONS_DIR  = os.path.join(SCRIPT_DIR, "icons")
os.makedirs(ICONS_DIR, exist_ok=True)


def render_svg(svg_path: str, size: int) -> Image.Image:
    """Render SVG to PIL Image at given size using macOS qlmanage."""
    with tempfile.TemporaryDirectory() as tmp:
        result = subprocess.run(
            ["qlmanage", "-t", "-s", str(size), "-o", tmp, svg_path],
            capture_output=True, text=True
        )
        basename = os.path.basename(svg_path) + ".png"
        out_path = os.path.join(tmp, basename)
        if not os.path.exists(out_path):
            raise RuntimeError(f"qlmanage failed: {result.stderr}")
        return Image.open(out_path).convert("RGBA").copy()


def macos_squircle_mask(size: int) -> Image.Image:
    """
    Generate a macOS-style squircle mask.
    macOS uses a superellipse (n≈5) with ~22% corner radius.
    We approximate it with an oversampled smooth rounded rect.
    """
    # Work at 4× for anti-aliasing, then downsample
    S = size * 4
    mask = Image.new("L", (S, S), 0)
    draw = ImageDraw.Draw(mask)

    # macOS corner radius ≈ 22.37% of icon size
    r = int(S * 0.2237)

    # Draw filled rounded rectangle
    draw.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)

    # Downsample with LANCZOS for smooth edges
    mask = mask.resize((size, size), Image.LANCZOS)
    return mask


def apply_macos_mask(img: Image.Image) -> Image.Image:
    """Apply macOS squircle mask — outside corners become transparent."""
    img = img.convert("RGBA")
    size = img.size[0]
    assert img.size[0] == img.size[1], "Icon must be square"

    mask = macos_squircle_mask(size)

    # Apply mask to alpha channel
    r, g, b, a = img.split()
    # Combine existing alpha with squircle mask
    new_alpha = Image.fromarray(
        __import__("numpy").minimum(
            __import__("numpy").array(a),
            __import__("numpy").array(mask)
        ).astype("uint8")
    )
    img.putalpha(new_alpha)
    return img


def apply_macos_mask_nonnumpy(img: Image.Image, padding_pct: float = 0.09) -> Image.Image:
    """
    Apply macOS squircle mask + inset padding.
    padding_pct: fraction of icon size to pad on each side (~9% matches Apple HIG).
    The artwork is scaled down and centered; background outside is transparent.
    """
    img = img.convert("RGBA")
    size = img.size[0]

    # Scale artwork down to create breathing room
    pad = int(size * padding_pct)
    inner_size = size - pad * 2
    artwork = img.resize((inner_size, inner_size), Image.LANCZOS)

    # Background: match icon's own bg color (dark) so edges look natural
    canvas = Image.new("RGBA", (size, size), (13, 12, 20, 255))
    canvas.paste(artwork, (pad, pad), artwork)

    # Apply squircle mask
    mask = macos_squircle_mask(size)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(canvas, mask=mask)
    return out


def main():
    print("Generating CC Manager icons from icon.svg …")

    if not os.path.exists(SVG_SRC):
        raise FileNotFoundError(f"icon.svg not found at {SVG_SRC}")

    # Render master at 1024px
    print("  Rendering SVG at 1024px …")
    raw = render_svg(SVG_SRC, 1024)
    print(f"  Raw size: {raw.size}")

    # Apply macOS squircle mask at master resolution
    print("  Applying macOS squircle mask …")
    master = apply_macos_mask_nonnumpy(raw, padding_pct=0.13)

    def sized(sz: int) -> Image.Image:
        if sz == 1024:
            return master
        img = master.resize((sz, sz), Image.LANCZOS)
        return img

    # PNG exports (with transparency)
    sizes = [
        ("32x32.png",          32),
        ("128x128.png",        128),
        ("128x128@2x.png",     256),
        ("icon_256x256.png",   256),
        ("icon_512x512.png",   512),
        ("icon_1024x1024.png", 1024),
        ("icon.png",           1024),
    ]
    for fname, sz in sizes:
        sized(sz).save(os.path.join(ICONS_DIR, fname), "PNG")
        print(f"  {fname}")

    # .icns via iconutil
    iconset_dir = os.path.join(ICONS_DIR, "icon.iconset")
    os.makedirs(iconset_dir, exist_ok=True)
    for fname, sz in [
        ("icon_16x16.png",      16),
        ("icon_16x16@2x.png",   32),
        ("icon_32x32.png",      32),
        ("icon_32x32@2x.png",   64),
        ("icon_128x128.png",    128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png",    256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png",    512),
        ("icon_512x512@2x.png", 1024),
    ]:
        sized(sz).save(os.path.join(iconset_dir, fname), "PNG")

    icns_path = os.path.join(ICONS_DIR, "icon.icns")
    r = subprocess.run(
        ["iconutil", "-c", "icns", iconset_dir, "-o", icns_path],
        capture_output=True, text=True
    )
    print(f"  icon.icns {'ok' if r.returncode == 0 else 'ERROR: ' + r.stderr}")

    # .ico — flatten onto dark bg (ICO doesn't support transparency well at small sizes)
    ico_bg = Image.new("RGBA", (256, 256), (13, 12, 20, 255))
    ico_fg = sized(256)
    ico_bg.paste(ico_fg, (0, 0), ico_fg)
    ico_bg.convert("RGB").save(
        os.path.join(ICONS_DIR, "icon.ico"), format="ICO",
        sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)]
    )
    print("  icon.ico")

    print(f"\nAll icons in src-tauri/icons/ — macOS squircle applied ✓")


if __name__ == "__main__":
    main()
