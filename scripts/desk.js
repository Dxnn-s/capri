#!/usr/bin/env node
// Start her on the desk, detached: her own process group, no console. Started from a
// terminal that later closes (or from a tool that owns the console), Electron got the
// console's close and quit with her a few seconds in (2026-10-26, twice). Her log goes to
// the user's temp folder.
//
//     node scripts/desk.js [--dev]
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const electron = require('electron'); // the binary's path, on every platform
const log = path.join(os.tmpdir(), 'capri-shell.log');
const out = fs.openSync(log, 'a');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // set by some hosts; it would run her main as plain Node
const child = spawn(electron, ['.', ...process.argv.slice(2)], { cwd: ROOT, env, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
child.on('error', (err) => { console.error(`could not start her: ${err.message}`); process.exitCode = 1; });
child.unref();
console.log(`capri on the desk, pid ${child.pid}, log ${log}`);
