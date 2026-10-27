"""Register a generated (or cut) drawing of Capri as a key pose for poses.js.

    python tools/make-pose.py <image.png> <name> [--anchor feet|seat|head] [--face-width 49 | --height 500]

Mattes her out with the palette rule from cut-pose.py (a transparent PNG passes through),
scales her so the face plate is the sprite's size (49 px wide on capri-full.png), writes
assets/capri/pose-<name>.png as a palette PNG, and prints the POSES entry: the anchor is
the point in the drawing that sits on her body's own anchor (her feet for a standing pose,
her seat for a sitting one, her head for a floating one), found from the matte.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import importlib.util

_spec = importlib.util.spec_from_file_location('cut_pose', Path(__file__).resolve().parent / 'cut-pose.py')
_cut_pose = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_cut_pose)
cut, palette_masks = _cut_pose.cut, _cut_pose.palette_masks

ROOT = Path(__file__).resolve().parent.parent
SPRITE_FACE_WIDTH = 49  # the green face plate on capri-full.png, rows 133..164


def face_width(rgba):
    """Width of the topmost green cluster: her face plate (the legs are green too, lower down)."""
    rgb = rgba[..., :3]
    _, green, _, _, _ = palette_masks(rgb)
    green &= rgba[..., 3] > 128
    rows = np.where(green.any(axis=1))[0]
    if len(rows) == 0:
        return None
    top = rows[0]
    band = green[top:top + int(0.12 * rgba.shape[0])]
    cols = np.where(band.any(axis=0))[0]
    return int(cols.max() - cols.min() + 1) if len(cols) else None


def key_background(img, tol=28):
    """Flood from the four corners over near-uniform background colour; those pixels go transparent."""
    from scipy import ndimage
    a = np.asarray(img).astype(np.int16)
    rgb = a[..., :3]
    corners = [rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]]
    bg = np.median(np.stack(corners), axis=0)
    near = (np.abs(rgb - bg).max(axis=2) <= tol)
    labels, n = ndimage.label(near)
    keep = set(labels[0, 0:1].tolist() + labels[0, -1:].tolist() + labels[-1, 0:1].tolist() + labels[-1, -1:].tolist())
    keep.discard(0)
    mask = np.isin(labels, list(keep))
    out = a.copy().astype(np.uint8)
    out[..., 3] = np.where(mask, 0, 255)
    # her ink is the same black as a black background: the keyed region stops at her edge,
    # and the inside black stays because it is not connected to the corners
    return Image.fromarray(out, 'RGBA')


def anchor_for(alpha, kind):
    ys, xs = np.where(alpha > 128)
    if kind == 'head':
        top = ys.min()
        band = xs[ys < top + 40]
        return int(band.mean()), int(top)
    if kind == 'seat':
        # the widest row in the lower half is where she sits
        half = alpha[alpha.shape[0] // 2:]
        widths = (half > 128).sum(axis=1)
        y = int(np.argmax(widths)) + alpha.shape[0] // 2
        row = np.where(alpha[y] > 128)[0]
        return int(row.mean()), y
    # feet: the lowest drawn row, its middle
    bottom = ys.max()
    row = xs[ys >= bottom - 6]
    return int(row.mean()), int(bottom)


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        print(__doc__)
        sys.exit(1)
    src, name = a[0], a[1]
    kind = a[a.index('--anchor') + 1] if '--anchor' in a else 'feet'
    want = int(a[a.index('--face-width') + 1]) if '--face-width' in a else SPRITE_FACE_WIDTH
    # --height H: scale the whole figure to H sprite pixels tall instead of matching the face
    # plate (the plate finder is fooled by green hands near the face); her standing rig is 420
    height = int(a[a.index('--height') + 1]) if '--height' in a else None
    img = Image.open(src).convert('RGBA')
    if img.getchannel('A').getextrema()[0] == 255:
        # an opaque render on a flat background: key the background out from the corners
        # first (so the black of a black background never counts as her ink), then matte
        keyed = key_background(img)
        tmp = Path(src).with_suffix('.keyed.png')
        keyed.save(tmp)
        img, _ = cut(str(tmp))
        tmp.unlink(missing_ok=True)
    rgba = np.asarray(img)
    if height:
        fw = None
        k = height / img.height
    else:
        fw = face_width(rgba)
        if not fw:
            raise SystemExit('no face plate found (no green near the top)')
        k = want / fw
    out = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    ax, ay = anchor_for(np.asarray(out)[..., 3], kind)
    dst = ROOT / 'assets' / 'capri' / f'pose-{name}.png'
    out.quantize(colors=96, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(dst, optimize=True)
    print(f'wrote {dst} {out.size} (' + (f'{height}px tall' if height else f'face plate {fw}px -> {want}px') + f', x{k:.2f})')
    print(f"  {name}: {{ file: 'pose-{name}.png', anchor: {{ x: {ax}, y: {ay} }} }},  // anchor: {kind}")


if __name__ == '__main__':
    main()
