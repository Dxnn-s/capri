// The brain's cues, acted out. Reze pushes marker lines over the runtime socket
// (the main process turns them into cues, src/main/reze.js); this is where each
// becomes something she does on the desk.
//
//   move    "[bridge-move] here"      she teleports next to the cursor (the brain needs you)
//   express "[bridge-express] smile"  a face and a short act, from the stage's vocabulary
//   speak   "[bridge-speak] line"     she says it: the panel shows it, her voice plays it
//   stop    "[bridge-stop]"           she shuts up
//   model   "[bridge-model] capri"    the stage switching skins; here she is always Capri
//   link    { linked }                the socket came up or went down

import { pick } from './util.js';

// the stage's faces and gestures -> her panel face and her act
const EXPRESS = {
  smile: { face: 'smug', act: 'hop' },
  surprised: { face: 'wide', act: 'flinch' },
  thinking: { face: 'aside', act: 'curious' },
  focused: { face: 'calm', act: 'look' },
  tired: { face: 'aside', act: 'fold' },
  asleep: { face: 'calm', act: 'fold', doze: true },
  sad: { face: 'aside', act: 'fold' },
  angry: { face: 'many', act: 'alarm' },
  cry: { face: 'aside', act: 'plop' },
  blank: { face: 'calm', act: null },
  pillow: { face: 'calm', act: 'fold' },
  flag: { face: 'laugh', act: 'victory' },
  eyebrow: { face: 'look', act: 'curious' },
  wink: { face: 'smug', act: 'hop' },
  pout: { face: 'aside', act: 'turn' },
  smirk: { face: 'smug', act: 'look' },
  laugh: { face: 'laugh', act: 'victory', cutin: true },
  embarrassed: { face: 'aside', act: 'turn' },
  nod: { face: 'look', act: 'hop' },
  shake: { face: 'aside', act: 'turn' },
  tilt: { face: 'look', act: 'curious' },
  doze: { face: 'calm', act: null, doze: true },
  slump: { face: 'aside', act: 'plop' },
  shrug: { face: 'aside', act: 'fold' },
  wave: { face: 'smug', act: 'point' },
  hug: { face: 'smug', act: 'fold' },
  curious: { face: 'look', act: 'curious' },
  sleepy: { face: 'calm', act: 'fold', doze: true },
  drift: { face: 'wide', act: 'spin' },
};

const SAY_MS_PER_CHAR = 55;

export class Link {
  constructor({ capri, panel, voice, host, brain }) {
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.host = host;
    this.brain = brain;
    this.audio = null;
    this.home = null; // where she was before the brain moved her ("back")
    this.linked = false;
  }

  async handle(cue) {
    if (!cue) return;
    switch (cue.kind) {
      case 'link': return this.onLink(cue.linked);
      case 'move': return this.move(cue.spot);
      case 'express': return this.express(cue.name);
      case 'speak': return this.speak(cue.text, cue.audio);
      case 'stop': return this.stop();
      case 'listen':
      case 'model':
      default: return undefined;
    }
  }

  onLink(linked) {
    const was = this.linked;
    this.linked = linked;
    if (linked && !was) {
      this.voice.play('hello');
      this.capri.perform('hop');
    }
  }

  // she comes out of whatever she was doing before acting a cue
  async ready() {
    const { capri, host } = this;
    if (capri.stowed) {
      host.setConfig({ visible: true });
      await capri.unstow();
    }
    if (capri.dormant) await capri.rouse();
    capri.wake();
    if (capri.stance === 'peek') await capri.unpeek();
  }

  async move(spot) {
    const { capri, host } = this;
    await this.ready();
    if (!this.home) this.home = { ...capri.pos };
    if (spot === 'stay') return;
    if (spot === 'here' || spot === 'follow') {
      const cursor = await host.cursor().catch(() => null);
      if (cursor?.inside) {
        await capri.summon(cursor);
      } else {
        await capri.teleport(capri.spot('stage'), { face: capri.towardCenter() });
      }
      capri.perform('curious', capri.towardCenter());
      return;
    }
    const { w } = capri.view;
    const s = capri.scale;
    const side = 150 * s + 30;
    const places = {
      corner: () => capri.spot('post'),
      right: () => capri.spot('post'),
      left: () => capri.spot('chip'),
      center: () => capri.spot('stage'),
      bottom: () => ({ x: Math.min(Math.max(capri.pos.x, side), w - side), y: capri.floor }),
      top: () => ({ x: Math.min(Math.max(capri.pos.x, side), w - side), y: 420 * s + 200 }),
      back: () => this.home || capri.spot('post'),
    };
    const to = (places[spot] || places.corner)();
    await capri.teleport(to, { face: capri.towardCenter() });
  }

  async express(name) {
    const { capri, panel } = this;
    const first = String(name || '').split('+')[0];
    const e = EXPRESS[first];
    if (!e) return;
    await this.ready();
    panel.setFace(e.face);
    if (e.cutin) capri.fx.cutin(...capri.cutinAt(capri.towardCenter()), { kind: pick(['laugh', 'grin']) });
    if (e.act) capri.perform(e.act, capri.towardCenter());
    if (e.doze) setTimeout(() => { if (!capri.busy) capri.setMode('sleep'); }, 1500);
  }

  // a line from the brain: on her panel, and in her voice when it came with one
  async speak(text, audio) {
    const { capri, panel } = this;
    await this.ready();
    const hold = Math.min(20000, 3000 + text.length * SAY_MS_PER_CHAR);
    panel.say({ kind: 'info', face: 'look', badge: 'REZE', line: text, hold });
    if (audio) this.play(audio);
    else capri.perform('talk');
  }

  // a line she already shows (a chat answer), in her voice: fetched now, then played
  async say(text) {
    const audio = await this.host.voice(text).catch(() => null);
    if (audio) this.play(audio);
  }

  play(base64) {
    this.stop();
    const el = new Audio(`data:audio/mpeg;base64,${base64}`);
    el.volume = this.voice.muted ? 0 : this.voice.volume;
    this.audio = el;
    const talk = () => { if (this.audio === el && !this.capri.busy) this.capri.perform('talk'); };
    el.addEventListener('play', talk);
    el.addEventListener('ended', () => { if (this.audio === el) this.audio = null; });
    // her mouth keeps going as long as the line does (the talk act is short)
    const mouth = setInterval(() => { if (this.audio !== el || el.ended || el.paused) clearInterval(mouth); else talk(); }, 700);
    el.play().catch(() => { clearInterval(mouth); this.audio = null; });
  }

  stop() {
    if (!this.audio) return;
    try { this.audio.pause(); } catch { /* already done */ }
    this.audio = null;
  }
}
