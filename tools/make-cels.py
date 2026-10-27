"""Cut a short clip of her into cels the desk can play on twos.

    python tools/make-cels.py <clip.mp4> <name> [--fps 12] [--height 550] [--anchor feet|seat]

The clip is an image-to-video render from one of her kept drawings on a flat black
background (Kling turbo, three seconds, about 4.5 credits). Frames are taken at `fps`
(12 = on twos from a 24 fps clip), the background is keyed out from the corners, every
frame is cropped to the same box (the union of the figure over the whole clip, so nothing
jumps), scaled so the figure is `height` sprite pixels tall, and written as palette PNGs:

    assets/capri/cels/<name>/NN.png
    assets/capri/cels/<name>.json   { fps, frames, width, height, anchor }

The anchor is the point that sits on her body's own anchor, found from the first frame.
Needs opencv, numpy, scipy and Pillow.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import importlib.util

_spec = importlib.util.spec_from_file_location('make_pose', Path(__file__).resolve().parent / 'make-pose.py')
_mp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mp)
key_background, anchor_for = _mp.key_background, _mp.anchor_for

ROOT = Path(__file__).resolve().parent.parent


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        print(__doc__)
        sys.exit(1)
    clip, name = a[0], a[1]
    fps = float(a[a.index('--fps') + 1]) if '--fps' in a else 12.0
    height = int(a[a.index('--height') + 1]) if '--height' in a else 550
    kind = a[a.index('--anchor') + 1] if '--anchor' in a else 'feet'

    cap = cv2.VideoCapture(clip)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    step = max(1, round(src_fps / fps))
    keyed = []
    i = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        if i % step == 0:
            img = Image.fromarray(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)).convert('RGBA')
            keyed.append(key_background(img))
        i += 1
    if not keyed:
        raise SystemExit('no frames')
    # one box for the whole clip
    boxes = [k.getchannel('A').getbbox() for k in keyed]
    boxes = [b for b in boxes if b]
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    k = height / (y1 - y0)
    out_dir = ROOT / 'assets' / 'capri' / 'cels' / name
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob('*.png'):
        old.unlink()
    frames = []
    size = None
    for n, img in enumerate(keyed):
        c = img.crop((x0, y0, x1, y1))
        c = c.resize((max(1, round(c.width * k)), max(1, round(c.height * k))), Image.LANCZOS)
        size = c.size
        c.quantize(colors=96, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(out_dir / f'{n:02d}.png', optimize=True)
        frames.append(f'{n:02d}.png')
    first = Image.open(out_dir / frames[0]).convert('RGBA')
    ax, ay = anchor_for(np.asarray(first)[..., 3], kind)
    manifest = {'fps': fps, 'frames': frames, 'width': size[0], 'height': size[1], 'anchor': {'x': int(ax), 'y': int(ay)}}
    (ROOT / 'assets' / 'capri' / 'cels' / f'{name}.json').write_text(json.dumps(manifest, indent=1))
    total = sum((out_dir / f).stat().st_size for f in frames)
    print(f'{len(frames)} cels at {fps:g} fps, {size[0]}x{size[1]}, anchor {ax},{ay}, {total // 1024} KB -> assets/capri/cels/{name}')


if __name__ == '__main__':
    main()
