// The exposure sheets: every drawing uses known pose fields, and the beats keyed from the
// show carry a smeared snap frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS, NEUTRAL } from '../src/renderer/js/acting.js';
import { POSES } from '../src/renderer/js/poses.js';

const FIELDS = new Set([...Object.keys(NEUTRAL), 'arms', 'reach', 'long']);

test('every act: positive holds, known fields only, a loop or a one-shot', () => {
  for (const [name, act] of Object.entries(ACTS)) {
    assert.ok(Array.isArray(act.keys) && act.keys.length, `${name} has drawings`);
    for (const [hold, pose, cue] of act.keys) {
      assert.ok(Number.isInteger(hold) && hold > 0, `${name}: hold ${hold}`);
      for (const k of Object.keys(pose)) assert.ok(FIELDS.has(k), `${name}: unknown field ${k}`);
      if (cue !== undefined) assert.equal(typeof cue, 'string', `${name}: cue`);
    }
  }
});

test('lean and recoil: directional beats on ones with one smeared snap frame and a hold', () => {
  for (const name of ['lean', 'recoil']) {
    const act = ACTS[name];
    assert.equal(act.fps, 24, `${name} on ones`);
    assert.equal(act.directional, true);
    const smeared = act.keys.filter(([, p]) => p.smear && (p.smear[0] || p.smear[1]));
    assert.ok(smeared.length >= 2, `${name}: a smear in and a smear out`);
    const snap = act.keys[1];
    assert.equal(snap[0], 1, `${name}: the snap is one frame`);
    const hold = Math.max(...act.keys.map(([h]) => h));
    assert.ok(hold >= 8, `${name}: held at least eight frames`);
    assert.deepEqual(act.keys.at(-1), [1, {}], `${name}: back to rest`);
  }
  assert.ok(ACTS.lean.keys[1][1].tilt > 20, 'the lean pitches the body over');
  assert.ok(ACTS.recoil.keys[1][1].tilt < -15 && ACTS.recoil.keys[1][1].armL > 1, 'the recoil throws her back, arms up');
});

test('poses: each show drawing names its file and anchor', () => {
  for (const [name, p] of Object.entries(POSES)) {
    assert.match(p.file, /^pose-[a-z]+\.png$/, name);
    assert.ok(p.anchor.x > 0 && p.anchor.y > 0, name);
  }
  assert.ok(POSES.sit);
});
