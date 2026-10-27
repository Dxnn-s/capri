// The link to the brain: the marker lines Reze pushes over the runtime socket
// become cues, and the settings come from the environment before the config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const reze = require('../src/main/reze.js');

test('parseCue: every marker the stage reads, and nothing for a plain message', () => {
  assert.deepEqual(reze.parseCue('[bridge-move] here'), { kind: 'move', spot: 'here' });
  assert.deepEqual(reze.parseCue('something first [bridge-move] corner'), { kind: 'move', spot: 'corner' });
  assert.deepEqual(reze.parseCue('[bridge-express] smile 6'), { kind: 'express', name: 'smile', secs: 6 });
  assert.deepEqual(reze.parseCue('[bridge-express] sad+slump'), { kind: 'express', name: 'sad+slump', secs: 0 });
  assert.deepEqual(reze.parseCue('[bridge-speak] come here a sec'), { kind: 'speak', text: 'come here a sec' });
  assert.deepEqual(reze.parseCue('[bridge-stop]'), { kind: 'stop' });
  assert.deepEqual(reze.parseCue('[bridge-model] capri'), { kind: 'model', name: 'capri' });
  assert.deepEqual(reze.parseCue('[bridge-listen] 8'), { kind: 'listen' });
  assert.equal(reze.parseCue('hey what are you doing'), null);
  assert.equal(reze.parseCue('[bridge-speak]   '), null, 'a speak marker with nothing to say is not a cue');
  assert.equal(reze.parseCue(''), null);
});

test('settings: the edge by default, the environment over the config', () => {
  const saved = { ...process.env };
  try {
    delete process.env.CAPRI_BRAIN; delete process.env.CAPRI_BRAIN_KEY; delete process.env.CAPRI_MODEL; delete process.env.CAPRI_VOICE;
    const d = reze.settings({});
    assert.equal(d.origin, reze.DEFAULT_ORIGIN);
    assert.equal(d.gateway, `${reze.DEFAULT_ORIGIN}/v1`);
    assert.equal(d.runtime, `${reze.DEFAULT_ORIGIN.replace(/^http/, 'ws')}/ws`);
    assert.equal(d.key, 'reze');
    assert.equal(d.model, 'capri');
    assert.equal(d.voice, 'capri');
    const c = reze.settings({ brainUrl: 'http://127.0.0.1:8901/', model: 'lelouch' });
    assert.equal(c.gateway, 'http://127.0.0.1:8901/v1');
    assert.equal(c.runtime, 'ws://127.0.0.1:8901/ws');
    assert.equal(c.model, 'lelouch');
    process.env.CAPRI_BRAIN = 'https://elsewhere.test';
    process.env.CAPRI_MODEL = 'capri';
    const e = reze.settings({ brainUrl: 'http://127.0.0.1:8901/', model: 'lelouch' });
    assert.equal(e.origin, 'https://elsewhere.test');
    assert.equal(e.model, 'capri');
  } finally {
    process.env = saved;
  }
});

test('Link: announces once the runtime answers, hands cues over, reconnects after a close', async () => {
  const sent = [];
  let sock;
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 1; sock = this; }
    send(s) { sent.push(JSON.parse(s).json); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const link = new reze.Link({ url: 'ws://test/ws', token: 'tok', wsImpl: FakeWS });
  const cues = []; const states = [];
  link.on('cue', (c) => cues.push(c));
  link.on('state', (s) => states.push(s.linked));
  link.start();
  sock.onopen();
  assert.deepEqual(sent[0], { type: 'module:authenticate', data: { token: 'tok' } });
  sock.onmessage({ data: JSON.stringify({ json: { type: 'module:authenticated', data: { authenticated: true } } }) });
  assert.equal(sent[1].type, 'extension:module:announce');
  assert.equal(sent[1].data.name, 'capri-shell');
  assert.deepEqual(sent[1].data.possibleEvents, ['input:text', 'input:text:voice']);
  sock.onmessage({ data: JSON.stringify({ json: { type: 'extension:module:announced', data: {} } }) });
  assert.deepEqual(states, [true]);
  sock.onmessage({ data: JSON.stringify({ json: { type: 'input:text', data: { text: '[bridge-move] here' } } }) });
  sock.onmessage({ data: JSON.stringify({ json: { type: 'input:text', data: { text: 'hi there' } } }) });
  sock.onmessage({ data: JSON.stringify({ json: { type: 'capri:cue', data: { text: '[bridge-express] smile 4' } } }) });
  assert.deepEqual(cues, [{ kind: 'move', spot: 'here' }, { kind: 'express', name: 'smile', secs: 4 }], 'cues arrive as input:text and as the broadcast capri:cue');
  assert.equal(reze.CUE_EVENT, 'capri:cue');
  const first = sock;
  first.close();
  assert.deepEqual(states, [true, false]);
  assert.ok(link.retry, 'a retry is scheduled');
  link.stop();
  assert.equal(link.closed, true);
});
