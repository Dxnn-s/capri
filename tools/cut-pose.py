"""Cut Capri out of a show frame into a transparent key-pose drawing.

    python tools/cut-pose.py <frame> <out.png> [--box x0,y0,x1,y1] [--keep-black 24] [--preview out-preview.png]

She is the only thing on screen in her palette: hot pink (speckled), neon green, a violet
edge, white speckles, and ink black inside those. The matte keeps every pixel in the
saturated palette, then the near-black pixels within `keep-black` px of them (her ink parts),
keeps only the components that touch the main pink mass, fills holes, and trims a one pixel
fringe. Backgrounds in the show are dim and desaturated, so the palette does the work.

Needs numpy, scipy and Pillow.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def args():
    a = sys.argv[1:]
    if len(a) < 2:
        print(__doc__)
        sys.exit(1)
    opts = {'box': None, 'keep_black': 14, 'preview': None}
    i = 2
    while i < len(a):
        if a[i] == '--box':
            opts['box'] = tuple(int(v) for v in a[i + 1].split(',')); i += 2
        elif a[i] == '--keep-black':
            opts['keep_black'] = int(a[i + 1]); i += 2
        elif a[i] == '--preview':
            opts['preview'] = a[i + 1]; i += 2
        else:
            i += 1
    return a[0], a[1], opts


def palette_masks(rgb):
    r, g, b = [rgb[..., i].astype(np.int16) for i in range(3)]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = (mx - mn)
    pink = (r > 150) & (r - g > 70) & (r - b > 30) & (b > g - 10)     # #ff2a6d and its shades
    green = (g > 140) & (g - r > 60) & (g - b > 60)                   # #39ff14
    violet = (b > 120) & (r > 60) & (b - g > 60) & (r < b + 40)        # the violet misregistration edge
    white = (mn > 215)                                                 # speckles and the grin
    black = (mx < 34) & (sat < 22)                                     # ink (the show's is near #0b0712; backgrounds sit above 40)
    return pink, green, violet, white, black


def cut(frame, box=None, keep_black=24):
    im = Image.open(frame).convert('RGB')
    if box:
        im = im.crop(box)
    rgb = np.asarray(im)
    pink, green, violet, white, black = palette_masks(rgb)
    core = pink | green | violet
    # white only when it sits on the figure (speckles, teeth), not a lamp in the background
    near_core = ndimage.binary_dilation(core, iterations=6)
    sure = core | (white & near_core)
    # her ink parts: black within reach of the saturated parts
    reach = ndimage.binary_dilation(sure, iterations=keep_black)
    mask = sure | (black & reach)
    mask = ndimage.binary_closing(mask, iterations=3)
    # only what hangs together with the biggest pink mass
    labels, n = ndimage.label(mask)
    if n == 0:
        raise SystemExit('nothing in her palette here')
    pink_labels = np.bincount(labels[pink & (labels > 0)], minlength=n + 1)
    main = int(np.argmax(pink_labels))
    sizes = ndimage.sum(np.ones_like(labels), labels, index=range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[main] = True
    # big pieces of her that touch the main mass through a thin neck count too
    for i in range(1, n + 1):
        if sizes[i - 1] > 0.02 * sizes[main - 1] and pink_labels[i] > 0.3 * sizes[i - 1]:
            keep[i] = True
    mask = keep[labels]
    # fill the small holes only: the show leaves real gaps in her, with the room showing through
    holes = ndimage.binary_fill_holes(mask) & ~mask
    hl, hn = ndimage.label(holes)
    if hn:
        hsizes = ndimage.sum(np.ones_like(hl), hl, index=range(1, hn + 1))
        small = np.zeros(hn + 1, bool)
        small[1:] = hsizes < 0.004 * mask.sum()
        mask = mask | small[hl]
    mask = ndimage.binary_erosion(mask, iterations=1)
    alpha = (mask * 255).astype(np.uint8)
    # soften the edge one pixel so the cut does not alias on screen
    alpha = ndimage.gaussian_filter(alpha.astype(np.float32), 0.6).clip(0, 255).astype(np.uint8)
    out = np.dstack([rgb, alpha])
    ys, xs = np.where(alpha > 8)
    if len(ys) == 0:
        raise SystemExit('empty matte')
    pad = 4
    y0, y1 = max(0, ys.min() - pad), min(out.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(out.shape[1], xs.max() + pad + 1)
    return Image.fromarray(out[y0:y1, x0:x1], 'RGBA'), (x0, y0, x1, y1)


def main():
    frame, out, o = args()
    img, bbox = cut(frame, o['box'], o['keep_black'])
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)
    print(f'wrote {out} {img.size} from {bbox}')
    if o['preview']:
        bg = Image.new('RGBA', img.size, (120, 120, 130, 255))
        bg.alpha_composite(img)
        bg.convert('RGB').save(o['preview'])
        print(f'preview {o["preview"]}')


if __name__ == '__main__':
    main()
