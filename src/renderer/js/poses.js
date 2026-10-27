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
  // generated (Nano Banana, show frames as references, round 1 variant 4): crouched, arms around her knees
  crouch: { file: 'pose-crouch.png', anchor: { x: 196, y: 548 } },
  // generated (round 3, show frames only, variant 4): the point at the sky, the cloud streaming back
  point: { file: 'pose-point.png', anchor: { x: 172, y: 538 } },
  // generated (round 2 retry, show laugh frames as references, variant 3): the cackle, mane exploded
  cackle: { file: 'pose-cackle.png', anchor: { x: 152, y: 498 } },
};

// Cel sets (tools/make-cels.py): a short clip of her, cut to frames on twos, keyed and
// packed. Each is a folder of PNGs and a manifest { fps, frames, width, height, anchor }.
// They are the fluid part: a drawing that breathes, a mane that drifts, in the show's own
// hand, looped on the desk where the shader rig would only warp one drawing.
export const CELS = {
  'crouch-idle': { file: 'cels/crouch-idle.json' },
};

export class PoseLayer {
  constructor(canvas, images, cels = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.images = images; // name -> ImageBitmap | HTMLImageElement
    this.cels = cels;     // name -> { manifest, frames: [ImageBitmap] }
    this.shown = null;
    this.playing = null;
  }

  hasCels(name) {
    return Boolean(this.cels[name] && this.cels[name].frames.length);
  }

  /**
   * Loop a cel set at its own fps until stop(); `at` is where its anchor sits, screen px.
   * Frames change on whole frames (no blending), like cels.
   */
  play(name, { at, scale = 0.6, facing = 1, loop = true, onEnd = null } = {}) {
    const set = this.cels[name];
    if (!set) return false;
    this.stop();
    const { manifest, frames } = set;
    const dpr = devicePixelRatio;
    const state = { name, i: -1, raf: 0, t0: performance.now() };
    this.playing = state;
    const draw = (now) => {
      if (this.playing !== state) return;
      const idx = Math.floor((now - state.t0) / (1000 / manifest.fps));
      if (!loop && idx >= frames.length) { this.stop(); onEnd?.(); return; }
      const i = idx % frames.length;
      if (i !== state.i) {
        state.i = i;
        const { ctx, canvas } = this;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(at.x, at.y);
        ctx.scale(scale * facing, scale);
        ctx.translate(-manifest.anchor.x, -manifest.anchor.y);
        ctx.drawImage(frames[i], 0, 0);
        this.canvas.hidden = false;
        this.shown = name;
      }
      state.raf = requestAnimationFrame(draw);
    };
    state.raf = requestAnimationFrame(draw);
    return true;
  }

  stop() {
    if (this.playing) { cancelAnimationFrame(this.playing.raf); this.playing = null; }
    this.hide();
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
    if (this.playing) { cancelAnimationFrame(this.playing.raf); this.playing = null; }
    if (!this.shown) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.hidden = true;
    this.shown = null;
  }
}
