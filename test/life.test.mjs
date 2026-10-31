// Her idle life layer and the springs that carry a glide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Spring, Life } from '../src/renderer/js/life.js';

test('Spring: settles on its target; critically damped never overshoots, a bouncy one does', () => {
  const s = new Spring({ k: 80, zeta: 1, value: 0, target: 100 });
  let peak = 0;
  for (let i = 0; i < 240; i++) { s.step(1 / 60); peak = Math.max(peak, s.value); }
  assert.ok(Math.abs(s.value - 100) < 0.5, `settled: ${s.value}`);
  assert.ok(peak <= 100.01, `no overshoot: ${peak}`);
  assert.equal(s.settled, true);
  const b = new Spring({ k: 80, zeta: 0.3, value: 0, target: 100 });
  let over = 0;
  for (let i = 0; i < 240; i++) { b.step(1 / 60); over = Math.max(over, b.value); }
  assert.ok(over > 110, `a bouncy spring swings past: ${over}`);
  assert.ok(Math.abs(b.value - 100) < 1, 'and still settles');
  const long = new Spring({ k: 80, zeta: 1, value: 0, target: 10 });
  long.step(1.0); // one long frame is split into small steps, so it cannot blow up
  assert.ok(Math.abs(long.value - 10) < 0.5 && Number.isFinite(long.value));
});

test('Life: small bounded deltas at rest; the mane lags a move the other way and settles after', () => {
  const life = new Life({ random: () => 0.5 });
  let t = 0;
  let out;
  for (let i = 0; i < 180; i++) { t += 1000 / 24; out = life.step(t, { x: 300, y: 500 }); }
  assert.ok(Math.abs(out.bob) < 2 && Math.abs(out.tilt) < 2 && Math.abs(out.head) < 0.12 && Math.abs(out.hair) < 1, JSON.stringify(out));
  assert.equal(out.vx, 0);
  // she moves right at 600 px/s for a third of a second
  let x = 300;
  for (let i = 0; i < 8; i++) { t += 1000 / 24; x += 25; out = life.step(t, { x, y: 500 }); }
  assert.ok(out.vx > 500, `speed seen: ${out.vx}`);
  assert.ok(out.hair < -4, `the mane trails behind, to the left: ${out.hair}`);
  assert.ok(out.tilt > 2, `she leans into it: ${out.tilt}`);
  // she stops: the mane swings back and settles
  for (let i = 0; i < 72; i++) { t += 1000 / 24; out = life.step(t, { x, y: 500 }); }
  assert.ok(Math.abs(out.hair) < 1.5, `settled: ${out.hair}`);
  // a teleport is not a move
  out = life.step(t + 1000 / 24, { x: x + 900, y: 500 });
  assert.equal(out.vx, 0);
});

test('Life (0.8.0): his pointer pulls her head and holds it; gone, the glances come back; an ended act carries through', () => {
  const life = new Life({ random: () => 0.5 });
  let t = 0;
  let out;
  for (let i = 0; i < 48; i++) { t += 1000 / 24; out = life.step(t, { x: 300, y: 500 }, { lookAt: 0.16 }); }
  assert.ok(out.head > 0.14, `the head turned to the pointer: ${out.head}`);
  for (let i = 0; i < 48; i++) { t += 1000 / 24; out = life.step(t, { x: 300, y: 500 }, { lookAt: 0.16 }); }
  assert.ok(Math.abs(out.head - 0.16) < 0.01, `and holds there: ${out.head}`);
  for (let i = 0; i < 72; i++) { t += 1000 / 24; out = life.step(t, { x: 300, y: 500 }); }
  assert.ok(Math.abs(out.head) < 0.12, `pointer gone, back to her own glances: ${out.head}`);
  // asleep she does not follow it
  const dozing = new Life({ random: () => 0.5 });
  let z;
  for (let i = 0; i < 48; i++) { z = dozing.step(i * 1000 / 24, { x: 300, y: 500 }, { asleep: true, lookAt: 0.16 }); }
  assert.ok(Math.abs(z.head) < 0.02, `asleep, no following: ${z.head}`);
  // follow-through: a kick shows on the next frame and is gone within a second
  const after = new Life({ random: () => 0.5 });
  after.step(0, { x: 300, y: 500 });
  after.kick({ head: 0.2, hair: 8, mane: 0.3 });
  let k = after.step(1000 / 24, { x: 300, y: 500 });
  assert.ok(k.head > 0.08 && k.hair > 3 && k.mane > 0.1, `carried: ${JSON.stringify(k)}`);
  for (let i = 2; i < 30; i++) k = after.step(i * 1000 / 24, { x: 300, y: 500 });
  assert.ok(Math.abs(k.head) < 0.12 && Math.abs(k.hair) < 2 && Math.abs(k.mane) < 0.08, `settled: ${JSON.stringify(k)}`);
});
