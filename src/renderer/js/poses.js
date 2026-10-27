// Key drawings cut straight from the show (tools/cut-pose.py), shown whole on a beat: the
// sprite under the shader hides, the show's own drawing snaps in with a smear, holds a few
// frames, and the shader takes over again. Hard cuts, no tween: that is how Trigger does it.
//
// Each drawing has an anchor, the point in it that sits where her body's own anchor is
// (her seat for a sitting drawing, her feet for a standing one), in drawing pixels at the
// drawing's own scale (the drawings are made so her head is the sprite's size).

export const POSES = {
  // ep 2: cross-legged on the edge of the bed, mane filling the room; the anchor is her seat
  sit: { file: 'pose-sit.png', anchor: { x: 432, y: 552 } },
};

export class PoseLayer {
  constructor(canvas, images) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.images = images; // name -> ImageBitmap | HTMLImageElement
    this.shown = null;
  }

  has(name) {
    return Boolean(this.images[name]);
  }

  resize(w, h) {
    this.canvas.width = Math.round(w * devicePixelRatio);
    this.canvas.height = Math.round(h * devicePixelRatio);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /**
   * Show a drawing with its anchor at `at` (screen px), at her scale, facing as she does
   * (facing 1 is the drawing as cut; -1 mirrors it). `smear` draws two trailing ghosts along
   * that vector first (screen px), for the frame of the snap.
   */
  show(name, { at, scale = 0.6, facing = 1, smear = null, alpha = 1 } = {}) {
    const image = this.images[name];
    const pose = POSES[name];
    if (!image || !pose) return false;
    const { ctx, canvas } = this;
    const dpr = devicePixelRatio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const draw = (dx, dy, a) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(at.x + dx, at.y + dy);
      ctx.scale(scale * facing, scale);
      ctx.translate(-pose.anchor.x, -pose.anchor.y);
      ctx.globalAlpha = a;
      ctx.drawImage(image, 0, 0);
    };
    if (smear && (smear[0] || smear[1])) {
      draw(smear[0], smear[1], 0.22 * alpha);
      draw(smear[0] * 0.5, smear[1] * 0.5, 0.38 * alpha);
    }
    draw(0, 0, alpha);
    ctx.globalAlpha = 1;
    this.canvas.hidden = false;
    this.shown = name;
    return true;
  }

  hide() {
    if (!this.shown) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.hidden = true;
    this.shown = null;
  }
}
