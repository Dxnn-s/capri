// The behaviors (0.4.0): the spots the brain can push for a seat, a peek, hiding, possessing,
// sleep, waking and a stroll, and the throw when she is flung. Source pins, since the
// renderer needs a window; the physics are checked where they are pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const link = fs.readFileSync(new URL('../src/renderer/js/link.js', import.meta.url), 'utf8');
const capri = fs.readFileSync(new URL('../src/renderer/js/capri.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');

test('link.js: every behavior spot has a case', () => {
  for (const spot of ['sit', 'peek', 'hide', 'possess', 'sleep', 'wake', 'stroll']) assert.match(link, new RegExp(`case '${spot}'`), spot);
  assert.match(link, /case 'hide': return capri\.canPossess\(\) \? capri\.possess\(\) : capri\.peek\(/, 'hide is a possession when seated, a peek otherwise');
  assert.match(link, /case 'sleep': capri\.setMode\('sleep'\); return;/);
  assert.match(link, /case 'wake': capri\.wake\(\); capri\.perform\('hop'\); return;/, 'wake wakes her before the hop');
  assert.match(link, /case 'stroll': if \(await capri\.stroll\(\)\) return; break;/, 'a stroll she cannot take becomes a plain move');
});

test('capri.js: the stroll hops along the floor and turns at walls; a fling becomes a toss with walls and a bounce', () => {
  assert.match(capri, /async stroll\(dir = 0, steps = 3 \+ Math\.floor\(Math\.random\(\) \* 3\)\) \{/);
  assert.match(capri, /if \(x < side \|\| x > w - side\) \{ d = -d;/, 'a wall turns her');
  assert.match(capri, /toss\(vx, vy\) \{\n\s+if \(this\.stance === 'fall'\) return;\n\s+this\.fall\(\);\n\s+this\.vx = clamp\(vx, -1800, 1800\);/);
  assert.match(capri, /if \(x < edge\) \{ x = edge; this\.vx = -this\.vx \* 0\.55;/, 'the left wall');
  assert.match(capri, /this\.facing = this\.vx < 0 \? 1 : -1;\n\s+if \(Math\.abs\(this\.vx\) < 40\) this\.vx = 0;/, 'she faces the way she flew, read before the speed is zeroed');
  assert.match(capri, /const ceiling = SPRITE\.height \* this\.scale \* 0\.6;/, 'the top is a wall');
  assert.match(capri, /if \(this\.vx && this\.bounces < 2 && this\.vy > 900 && target\.stance === 'stand'\) \{/, 'a bounce on a hard landing');
  assert.match(capri, /const v = this\.flingSpeed\(trail\);\n\s+if \(v\) this\.toss\(v\.vx, v\.vy\);\n\s+else this\.drop\(\);/);
  assert.match(capri, /return Math\.hypot\(vx, vy\) > 700 \? \{ vx, vy \} : null;/, 'a slow let-go is a drop');
});

test('capri.js (0.8.0): the beats fire from behave, the pointer pulls her gaze, she rests on her cels, acts carry through', () => {
  assert.match(capri, /if \(this\.mode === 'idle' && !this\.act && !this\.gliding && !this\.focus && \(this\.stance === 'stand' \|\| this\.stance === 'sit'\) && now > this\.nextBeat\) \{/, 'a beat only when nothing else is on');
  assert.match(capri, /pick\(this\.stance === 'sit' \? \['shift', 'scan', 'fidget'\] : \['shift', 'scan', 'stretch', 'fidget'\]\)/, 'no stretch on a ledge');
  assert.match(capri, /return clamp\(dx \/ 260, -1, 1\) \* 0\.16 \* this\.facing;/, 'the gaze rides on facing');
  assert.match(capri, /lookAt: this\.lookAt\(\) \}\);/, 'the life layer gets it every frame');
  assert.match(capri, /if \(this\.resting && \(now > this\.resting\.until \|\| !this\.canRest\(\)\)\) this\.unrest\(\);/, 'anything that happens ends the rest');
  assert.match(capri, /this\.poses\.play\('crouch-idle', \{ at: \{ \.\.\.this\.pos \}, scale: this\.scale, facing: this\.facing \}\);/, 'the cels loop at her feet');
  assert.match(capri, /&& this\.pos\.y >= this\.floor - 2 && !reducedMotion\.matches\);/, 'only on the floor');
  assert.match(capri, /this\.life\.kick\(\{ head: this\.lastAct\.head \|\| 0, hair: this\.lastAct\.hair \|\| 0, mane: this\.lastAct\.mane \|\| 0 \}\);/, 'the last drawing carries into the springs');
});

test('flingSpeed: the last tenth of a second of a drag, pure', () => {
  // lift the function out of the class source and run it on its own
  const src = capri.slice(capri.indexOf('  flingSpeed(trail) {'), capri.indexOf('  drop() {'));
  const fn = new Function(`return function ${src.trim()}`)();
  const t0 = 1000;
  const slow = Array.from({ length: 6 }, (_, i) => ({ x: 100 + i * 2, y: 200, t: t0 + i * 20 }));
  assert.equal(fn(slow), null);
  const fast = Array.from({ length: 6 }, (_, i) => ({ x: 100 + i * 30, y: 200 - i * 4, t: t0 + i * 20 }));
  const v = fn(fast);
  assert.ok(v && v.vx > 1000 && v.vy < 0, JSON.stringify(v));
  assert.equal(fn([{ x: 0, y: 0, t: 0 }]), null);
});

test('main.js: the debug drag route for trying a fling from a script', () => {
  assert.match(main, /if \(route === 'drag'\) \{/);
  assert.match(main, /type: 'mouseUp', button: 'left', clickCount: 1, \.\.\.to/);
});
