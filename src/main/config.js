'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  scale: 0.6,        // sprite scale, 0.6 ≈ 250px tall
  muted: false,
  volume: 0.7,
  lang: 'en',        // her lines; 'auto' follows the system language
  displayId: null,   // null = primary display
  wander: true,      // random teleports when idle
  possess: true,     // now and then she dives into the window she sits on and takes it over
  visible: true,
  welcomed: false,   // she has introduced herself (her welcome panel)
  linked: false,     // a Claude Code event has reached her at least once
  chatModel: null,   // who answers her chat, from the gateway's roster (null: capri, the skin)
  brainUrl: '',      // the brain's edge (empty: the default in reze.js); CAPRI_BRAIN overrides
  brainKey: '',      // the gateway's bearer (empty: 'reze'); CAPRI_BRAIN_KEY overrides
  runtimeToken: '',  // the runtime socket's token, when it wants one; CAPRI_RUNTIME_TOKEN overrides
  voice: '',         // the gateway voice for her lines (empty: 'capri'); CAPRI_VOICE overrides
  notifications: true, // system notifications for Claude updates
  focusCustom: { work: 30, rest: 5, long: 15, rounds: 4 }, // focus mode, your own times (minutes)
};

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('[capri] could not save config:', err.message);
  }
  return cache;
}

module.exports = { load, save, DEFAULTS };
