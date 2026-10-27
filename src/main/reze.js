'use strict';

// Her link to the brain. Capri on this desk is Reze's body, so everything she
// knows, says and does comes from the brain on the box (brain-bridge), through
// its edge: chat and speech over the companion gateway (OpenAI-shaped, /v1),
// and the cues the brain pushes over the runtime socket (/ws), the same frames
// the Live2D stage reads: "[bridge-express] smile 6", "[bridge-move] here",
// "[bridge-speak] a line to say", "[bridge-stop]", "[bridge-model] capri".
//
// Nothing here talks to Ollama or to Claude Code hooks any more: that was the
// upstream capri-desktop (mochiiwuff, MIT), kept in NOTICE.

const EventEmitter = require('node:events');

const DEFAULT_ORIGIN = 'https://win-kejvo9cld80.tail7557fd.ts.net';
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const PING_MS = 25000;
const CUE_EVENT = 'capri:cue'; // the same name brain-bridge's airi-push sends

const MARKERS = {
  express: '[bridge-express]',
  speak: '[bridge-speak]',
  stop: '[bridge-stop]',
  move: '[bridge-move]',
  model: '[bridge-model]',
  listen: '[bridge-listen]',
};

/** Where the brain is, from the environment first, then her config. */
function settings(cfg = {}) {
  const origin = String(process.env.CAPRI_BRAIN || cfg.brainUrl || DEFAULT_ORIGIN).trim().replace(/\/+$/, '');
  return {
    origin,
    gateway: `${origin}/v1`,
    runtime: `${origin.replace(/^http/, 'ws')}/ws`,
    key: String(process.env.CAPRI_BRAIN_KEY || cfg.brainKey || 'reze'),
    token: String(process.env.CAPRI_RUNTIME_TOKEN || cfg.runtimeToken || '').trim(),
    model: String(process.env.CAPRI_MODEL || cfg.model || 'reze'),
    voice: String(process.env.CAPRI_VOICE || cfg.voice || 'capri'),
  };
}

/**
 * One runtime frame's text -> the cue it carries, or null when it is an
 * ordinary message (someone talking to the stage) that is not for her body.
 */
function parseCue(text) {
  const s = String(text == null ? '' : text);
  let m;
  if (s.includes(MARKERS.stop)) return { kind: 'stop' };
  if (s.includes(MARKERS.move)) {
    m = /\[bridge-move\]\s*([a-z]+)/i.exec(s);
    return m ? { kind: 'move', spot: m[1].toLowerCase() } : null;
  }
  if (s.includes(MARKERS.model)) {
    m = /\[bridge-model\]\s*([a-z0-9-]+)/i.exec(s);
    return m ? { kind: 'model', name: m[1].toLowerCase() } : null;
  }
  if (s.includes(MARKERS.express)) {
    m = /\[bridge-express\]\s*([a-z+]+)(?:\s+(\d+))?/i.exec(s);
    return m ? { kind: 'express', name: m[1].toLowerCase(), secs: Number(m[2] || 0) } : null;
  }
  if (s.includes(MARKERS.speak)) {
    const i = s.indexOf(MARKERS.speak);
    const line = s.slice(i + MARKERS.speak.length).trim();
    return line ? { kind: 'speak', text: line } : null;
  }
  if (s.includes(MARKERS.listen)) return { kind: 'listen' }; // the laptop shell's job, not hers
  return null;
}

const wrap = (o) => JSON.stringify({ json: o });
function unwrap(raw) {
  try {
    const j = JSON.parse(String(raw));
    return j && j.json ? j.json : j;
  } catch {
    return null;
  }
}

/**
 * The runtime socket, kept open: authenticate (when the runtime wants a token),
 * announce as a module that listens for input:text, then every frame carrying
 * one of her markers comes out as a 'cue' event. 'state' fires with
 * { linked } on each change. Reconnects on its own, backing off to 30 s.
 */
class Link extends EventEmitter {
  constructor({ url, token = '', name = 'capri-shell', wsImpl = globalThis.WebSocket } = {}) {
    super();
    this.url = url;
    this.token = token;
    this.name = name;
    this.WS = wsImpl;
    this.ws = null;
    this.linked = false;
    this.closed = false;
    this.wait = RECONNECT_MIN_MS;
    this.retry = null;
    this.ping = null;
  }

  start() {
    this.closed = false;
    this.connect();
    return this;
  }

  stop() {
    this.closed = true;
    clearTimeout(this.retry);
    clearInterval(this.ping);
    try { this.ws?.close(); } catch { /* closing */ }
    this.ws = null;
    this.setLinked(false);
  }

  setLinked(on) {
    if (on === this.linked) return;
    this.linked = on;
    this.emit('state', { linked: on });
  }

  send(frame) {
    try {
      if (this.ws && this.ws.readyState === 1) this.ws.send(wrap(frame));
    } catch (err) {
      this.emit('error', err);
    }
  }

  announce() {
    this.send({
      type: 'extension:module:announce',
      data: {
        name: this.name,
        identity: { id: `${this.name}-desk`, extension: { id: this.name } },
        possibleEvents: ['input:text', 'input:text:voice'],
      },
    });
  }

  connect() {
    if (this.closed || !this.WS) return;
    let ws;
    try {
      ws = new this.WS(this.url);
    } catch (err) {
      this.emit('error', err);
      return this.later();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.wait = RECONNECT_MIN_MS;
      if (this.token) this.send({ type: 'module:authenticate', data: { token: this.token } });
      else this.announce();
      clearInterval(this.ping);
      // the runtime's own heartbeat: it marks a silent peer unhealthy, and the tailnet proxy sees traffic
      this.ping = setInterval(() => this.send({ type: 'transport:connection:heartbeat', data: { kind: 'ping', message: 'ping', at: Date.now() } }), PING_MS);
    };
    ws.onmessage = (ev) => {
      const frame = unwrap(ev.data);
      if (!frame || !frame.type) return;
      const d = frame.data || {};
      if (frame.type === 'error') {
        this.emit('error', new Error(`runtime: ${JSON.stringify(d).slice(0, 200)}`));
        return;
      }
      if (frame.type === 'module:authenticated') {
        if (d.authenticated === true) this.announce();
        else this.emit('error', new Error('runtime refused the token'));
        return;
      }
      if (frame.type === 'extension:module:announced' || frame.type === 'module:announced') {
        this.setLinked(true);
        return;
      }
      // input:text goes to one consumer only (the stage's chat-ingestion group),
      // so the brain pushes every marker a second time as capri:cue, which the
      // runtime broadcasts to every announced peer (2026-10-26, probed live).
      if (frame.type === CUE_EVENT || frame.type === 'input:text' || frame.type === 'input:text:voice') {
        const cue = parseCue(d.text);
        if (cue) this.emit('cue', cue);
      }
    };
    ws.onerror = () => { /* onclose follows and schedules the retry */ };
    ws.onclose = () => {
      clearInterval(this.ping);
      if (this.ws === ws) this.ws = null;
      this.setLinked(false);
      this.later();
    };
  }

  later() {
    if (this.closed) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connect(), this.wait);
    this.wait = Math.min(this.wait * 2, RECONNECT_MAX_MS);
  }
}

// ---------- the gateway: who answers, her answers, her voice ----------

function headers(s, extra = {}) {
  return { 'content-type': 'application/json', authorization: `Bearer ${s.key}`, ...extra };
}

async function failure(res) {
  const body = await res.text().catch(() => '');
  try {
    return new Error(JSON.parse(body).error.message);
  } catch {
    return new Error(body || `the brain answered ${res.status}`);
  }
}

/** The roster: every persona the gateway can answer as (reze, lelouch, ...). */
async function models(s) {
  const res = await fetch(`${s.gateway}/models`, { headers: headers(s), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw await failure(res);
  const { data = [] } = await res.json();
  return data.map((m) => m.id);
}

/**
 * Her answer, streamed: onDelta(piece) as it comes, resolves with all of it.
 * The gateway keeps the conversation itself (the brain's memory), so only the
 * newest user line matters; the rest of `messages` rides along for shape.
 */
async function chat(s, { model, messages }, onDelta, signal) {
  const res = await fetch(`${s.gateway}/chat/completions`, {
    method: 'POST',
    headers: headers(s),
    body: JSON.stringify({ model: model || s.model, messages, stream: true }),
    signal,
  });
  if (res.status === 429) throw new Error('busy');
  if (!res.ok) throw await failure(res);
  let text = '';
  let buf = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const take = (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const piece = JSON.parse(payload).choices?.[0]?.delta?.content;
      if (piece) {
        text += piece;
        onDelta?.(piece);
      }
    } catch { /* a keepalive or a partial line */ }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    lines.forEach(take);
  }
  if (buf) take(buf);
  return text;
}

/** Her voice: the line as mp3 bytes (base64), from the brain's Fish clone of her. */
async function speak(s, text, voice = s.voice) {
  const input = String(text || '').trim().slice(0, 2000);
  if (!input) return null;
  const res = await fetch(`${s.gateway}/audio/speech`, {
    method: 'POST',
    headers: headers(s),
    body: JSON.stringify({ input, voice, response_format: 'mp3' }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw await failure(res);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

module.exports = { settings, parseCue, Link, models, chat, speak, MARKERS, DEFAULT_ORIGIN, CUE_EVENT };
