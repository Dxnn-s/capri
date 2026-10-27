// Her idle life layer: the small continuous motion under every drawing, so she never stands
// still like a sticker. Springs do the travel (the mane lags behind a move and settles, the
// body leans into it); the beats stay hard snaps in acting.js. Everything here is additive
// and small: a breath, a weight shift, a glance, the mane's lag. Pure math, no DOM.

const TAU = Math.PI * 2;

/** A damped spring on one number: critically damped at zeta 1, bouncy below it. */
export class Spring {
  constructor({ k = 80, zeta = 1, value = 0, target = 0 } = {}) {
    this.k = k;
    this.zeta = zeta;
    this.value = value;
    this.target = target;
    this.v = 0;
  }

  /** Advance by dt seconds (semi-implicit Euler, split into small steps so a long frame can't blow up). */
  step(dt) {
    let left = Math.max(0, dt);
    const c = 2 * this.zeta * Math.sqrt(this.k);
    while (left > 0) {
      const h = Math.min(left, 1 / 120);
      const a = -this.k * (this.value - this.target) - c * this.v;
      this.v += a * h;
      this.value += this.v * h;
      left -= h;
    }
    return this.value;
  }

  get settled() {
    return Math.abs(this.value - this.target) < 0.5 && Math.abs(this.v) < 2;
  }

  snapTo(value) {
    this.value = value;
    this.target = value;
    this.v = 0;
  }
}

export class Life {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.last = null;
    this.lastPos = null;
    this.t = 0;
    this.phase = random() * TAU;
    this.mane = new Spring({ k: 70, zeta: 0.35 }); // hair sway, px: lags a move and swings back
    this.lean = new Spring({ k: 90, zeta: 0.6 });  // whole-body tilt into a move, degrees
    this.gaze = new Spring({ k: 50, zeta: 0.85 }); // a glance, head radians
    this.nextGlance = 0;
    this.glanceUntil = 0;
    this.vx = 0;
    this.vy = 0;
  }

  /** Forget where she was: the next frame starts from rest (after frames the layer sat out). */
  reset() {
    this.last = null;
    this.lastPos = null;
    this.vx = 0;
    this.vy = 0;
  }

  /**
   * One frame: her position on screen (px) and her state. Returns the deltas to add to the
   * drawing: { bob, hair, tilt, head, mane, vx, vy }. Call it every drawn frame.
   */
  step(now, pos, { asleep = false, moving = false } = {}) {
    const dt = this.last == null ? 0 : Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.t += dt;

    // her speed, from where she was last frame: a glide moves her, the mane trails
    if (this.lastPos && dt > 0) {
      const dx = pos.x - this.lastPos.x;
      const dy = pos.y - this.lastPos.y;
      // a teleport is not a move: further than a glide covers in one frame, and the mane stays put
      const jump = Math.hypot(dx, dy) > 60;
      this.vx = jump ? 0 : dx / dt;
      this.vy = jump ? 0 : dy / dt;
    }
    this.lastPos = { x: pos.x, y: pos.y };

    this.mane.target = clamp(-this.vx * 0.018, -16, 16);
    this.lean.target = clamp(this.vx * 0.012, -7, 7);
    this.mane.step(dt);
    this.lean.step(dt);

    // a glance now and then: the head turns a little and comes back
    if (!asleep && !moving && now > this.nextGlance) {
      this.nextGlance = now + 4000 + this.random() * 9000;
      this.glanceUntil = now + 500 + this.random() * 900;
      this.gaze.target = (this.random() < 0.5 ? -1 : 1) * (0.04 + this.random() * 0.05);
    }
    if (now > this.glanceUntil) this.gaze.target = 0;
    this.gaze.step(dt);

    // breath: slow when asleep, a touch of second harmonic so it is not a metronome
    const rate = asleep ? 0.16 : 0.28;
    const b = Math.sin(this.t * TAU * rate + this.phase);
    const b2 = Math.sin(this.t * TAU * rate * 2 + this.phase * 0.7);
    const breath = (asleep ? 1.6 : 1.1) * (b + 0.25 * b2);
    // a slow weight shift, degrees
    const shift = 0.7 * Math.sin(this.t * TAU * 0.07 + this.phase * 1.3);

    return {
      bob: breath,
      hair: this.mane.value,
      tilt: this.lean.value + shift,
      head: this.gaze.value,
      mane: 0.02 * b,
      vx: this.vx,
      vy: this.vy,
    };
  }
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
