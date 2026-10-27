'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage,
  clipboard, ClipboardItem, Notification, dialog,
} = require('electron');

const config = require('./config');
const { TRAY, LANGS } = require('./labels');
const { createBridge } = require('./bridge');
const { startWindowWatch } = require('./windows');
const reze = require('./reze');
const apps = require('./apps');
const { createFocus, checkTimes, LIMITS } = require('./focus');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.CAPRI_PORT) || 47823;
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;
// the brain: where chat, her voice and her cues come from (src/main/reze.js)
let brain = reze.settings(); // from the environment now; her config joins in once the app is up (relink)
let link = null; // the runtime socket, once the app is up

protocol.registerSchemesAsPrivileged([
  { scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let overlay = null;
let tray = null;
let trayMenu = null; // also what she opens when you right-click her
let demoTimer = null;
let windowWatch = null;
// the watcher only speaks when something changes: the overlay asks for this when it (re)loads
let lastWindows = null;
let chatModels = null; // the gateway's roster, as last seen (null: the brain not reached)
const chats = new Map(); // id -> AbortController of an answer being streamed
// focus mode (her pomodoro): each change goes to the overlay, and the tray shows where it's at
const focus = createFocus({
  onChange: (event, state) => {
    sendCommand('focus', { event, state });
    rebuildTray();
  },
  custom: () => config.load().focusCustom,
});
let timesWin = null; // the little window where you type your own focus times

const userSoundsDir = () => path.join(app.getPath('userData'), 'sounds');

// capri://app/...        -> files of this repo
// capri://usersounds/... -> the user's own sound overrides
function serveProtocol() {
  protocol.handle('capri', (request) => {
    const url = new URL(request.url);
    const base = url.host === 'usersounds' ? userSoundsDir() : ROOT;
    const target = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (target !== base && !target.startsWith(base + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function targetDisplay() {
  const { displayId } = config.load();
  return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

function fitOverlay() {
  if (!overlay) return;
  const { workArea } = targetDisplay();
  overlay.setBounds(workArea);
  overlay.webContents.send('overlay:resize', { width: workArea.width, height: workArea.height });
}

function createOverlay() {
  const { workArea } = targetDisplay();
  overlay = new BrowserWindow({
    ...workArea,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  // Multi virtual desktop: follow across all macOS Spaces / Linux workspaces
  if (typeof overlay.setVisibleOnAllWorkspaces === 'function') {
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  overlay.loadURL('capri://app/src/renderer/index.html');
  // always shown: put away, she's still there as her biochip in the corner
  overlay.once('ready-to-show', () => overlay.showInactive());
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
  });
  if (DEV) {
    overlay.webContents.on('console-message', (e) => {
      const { level, message, lineNumber, sourceId } = e;
      console.log(`[renderer:${level}] ${message} (${String(sourceId).split('/').pop()}:${lineNumber})`);
    });
    if (process.env.CAPRI_DEVTOOLS) overlay.webContents.openDevTools({ mode: 'detach' });
  }
}

function sendCommand(name, payload = {}) {
  overlay?.webContents.send('capri:command', { name, ...payload });
}

// Ctrl+Alt+C: she folds herself away into her biochip in the corner, or comes back out of it.
function toggleVisible(force) {
  const visible = typeof force === 'boolean' ? force : !config.load().visible;
  config.save({ visible });
  sendCommand('stow', { on: !visible });
  rebuildTray();
}

// During the demo, a little fake terminal for her to sit on and take over (window tracking is
// Windows only, so only there). Opened without stealing focus; closing it drops her off it.
let demoWin = null;
const DEMO_TERMINAL = `<body style="margin:0;background:#14101c;color:#8f8aa3;font:13px/1.7 Consolas,monospace;padding:14px 18px">
<div style="color:#36ff7a">PS C:\\night-city-api&gt; npm test -- gigs</div>
<div>&nbsp;&nbsp;GET /gigs</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ returns 20 items per page</div>
<div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ paginates with a cursor</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ rejects a bad cursor</div>
<div>&nbsp;&nbsp;6 passing (212ms)</div><div style="color:#36ff7a">PS C:\\night-city-api&gt; _</div></body>`;

function demoWindow(open) {
  demoWin?.destroy();
  demoWin = null;
  if (!open || process.platform !== 'win32') return false;
  const b = overlay.getBounds();
  demoWin = new BrowserWindow({
    x: Math.round(b.x + b.width * 0.5 - 310), y: Math.round(b.y + b.height * 0.42), width: 620, height: 300,
    show: false, alwaysOnTop: true, title: 'night-city-api — npm test', backgroundColor: '#14101c', autoHideMenuBar: true,
  });
  demoWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DEMO_TERMINAL)}`);
  demoWin.once('ready-to-show', () => demoWin?.showInactive());
  demoWin.on('closed', () => { demoWin = null; });
  return true;
}

// "Set my own times…": a small window (the overlay can't take typing) with the four numbers.
// Saving keeps them in the config for "Start my times"; "Save and start" starts a round with them.
function openFocusTimes() {
  if (timesWin) {
    timesWin.show();
    timesWin.focus();
    return;
  }
  const { workArea } = targetDisplay();
  const width = 400, height = 470;
  timesWin = new BrowserWindow({
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width, height, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, autoHideMenuBar: true, backgroundColor: '#14101c', show: false,
    title: TRAY[resolveLang(config.load().lang)].timesTitle,
    icon: path.join(ROOT, 'assets', 'icons', 'tray.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  timesWin.loadURL('capri://app/src/renderer/focus-times.html');
  timesWin.once('ready-to-show', () => timesWin?.show());
  timesWin.on('closed', () => { timesWin = null; });
}

// 'auto' -> the first system language Capri speaks, English otherwise.
function resolveLang(setting) {
  if (LANGS.includes(setting)) return setting;
  const preferred = [...app.getPreferredSystemLanguages(), app.getSystemLocale(), app.getLocale()];
  for (const tag of preferred) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

// What the overlay gets: `lang` is the resolved one, `langSetting` what the user picked.
function rendererConfig() {
  const cfg = config.load();
  return { ...cfg, lang: resolveLang(cfg.lang), langSetting: cfg.lang };
}

function updateConfig(patch) {
  config.save(patch);
  const cfg = rendererConfig();
  overlay?.webContents.send('capri:config', cfg);
  rebuildTray();
  return cfg;
}

function rebuildTray() {
  if (!tray) return;
  const cfg = config.load();
  const t = TRAY[resolveLang(cfg.lang)];

  const displays = screen.getAllDisplays();
  const current = targetDisplay().id;

  const f = focus.state;
  const focusMenu = f.phase === 'off'
    ? [
      { label: t.focusClassic, click: () => focus.start('classic') },
      { label: t.focusDeep, click: () => focus.start('deep') },
      { label: t.focusMine(cfg.focusCustom), click: () => focus.start('custom') },
      { type: 'separator' },
      { label: t.focusSet, click: openFocusTimes },
    ]
    : [
      { label: t.focusNow(f.phase, f.round, f.rounds), enabled: false },
      f.paused
        ? { label: t.focusResume, click: () => focus.resume() }
        : { label: t.focusPause, click: () => focus.pause() },
      { label: f.phase === 'work' ? t.focusSkipWork : t.focusSkipBreak, click: () => focus.skip() },
      { label: t.focusStop, click: () => focus.stop() },
    ];

  const menu = Menu.buildFromTemplate([
    { label: link?.linked ? (t.brainOn || TRAY.en.brainOn) : (t.brainOff || TRAY.en.brainOff), enabled: false },
    { label: t.reconnect || TRAY.en.reconnect, click: () => relink() },
    { label: t.summon || TRAY.en.summon, click: () => handleCue({ kind: 'move', spot: 'here' }) },
    { type: 'separator' },
    { label: t.focus, submenu: focusMenu },
    { type: 'separator' },
    { label: t.teleport, click: () => sendCommand('teleport') },
    { label: t.satellite, click: () => sendCommand('satellite') },
    { label: t.help, click: () => sendCommand('welcome') },
    { label: t.report, click: () => sendCommand('report') },
    { label: t.talk, click: () => sendCommand('chat') },
    { label: cfg.visible ? t.hide : t.show, accelerator: 'Ctrl+Alt+C', click: () => toggleVisible() },
    { type: 'separator' },
    {
      label: t.size,
      submenu: [[t.small, 0.45], [t.medium, 0.6], [t.large, 0.8]].map(([label, scale]) => ({
        label, type: 'radio', checked: Math.abs(cfg.scale - scale) < 0.01, click: () => updateConfig({ scale }),
      })),
    },
    {
      label: t.sound,
      submenu: [
        { label: t.mute, type: 'checkbox', checked: cfg.muted, click: (item) => updateConfig({ muted: item.checked }) },
        { type: 'separator' },
        {
          label: t.soundsDir,
          click: () => {
            fs.mkdirSync(userSoundsDir(), { recursive: true });
            shell.openPath(userSoundsDir());
          },
        },
      ],
    },
    {
      label: t.screen,
      enabled: displays.length > 1,
      submenu: displays.map((d, i) => ({
        label: `${i + 1} — ${d.size.width}×${d.size.height}`,
        type: 'radio',
        checked: d.id === current,
        click: () => { config.save({ displayId: d.id }); fitOverlay(); rebuildTray(); },
      })),
    },
    {
      label: t.chatModel,
      submenu: chatModels?.length
        ? chatModels.map((name) => ({
          label: name, type: 'radio', checked: name === pickModel(cfg), click: () => updateConfig({ chatModel: name }),
        }))
        : [{ label: t.noOllama, enabled: false }],
    },
    { label: t.wander, type: 'checkbox', checked: cfg.wander, click: (item) => updateConfig({ wander: item.checked }) },
    { label: t.possess, type: 'checkbox', checked: cfg.possess, click: (item) => updateConfig({ possess: item.checked }) },
    { label: t.notifications, type: 'checkbox', checked: cfg.notifications, click: (item) => updateConfig({ notifications: item.checked }) },
    {
      label: t.lang,
      submenu: [[t.auto, 'auto'], ...LANGS.map((lang) => [TRAY[lang].name, lang])].map(([label, lang]) => ({
        label, type: 'radio', checked: cfg.lang === lang, click: () => updateConfig({ lang }),
      })),
    },
    {
      label: t.startup,
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: t.quit, click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  trayMenu = menu;
}

// Run from a clone (`npm start`), electron.exe alone would open the default Electron app at login:
// it needs the project folder as argument.
function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [ROOT] };
}

// Who answers her chat: the persona picked in her menu when the gateway still
// lists it, else the configured one (reze by default).
function pickModel(cfg = config.load()) {
  const wanted = cfg.chatModel || brain.model;
  if (!chatModels?.length) return wanted;
  return chatModels.includes(wanted) ? wanted : chatModels[0];
}

async function refreshModels() {
  chatModels = await reze.models(brain).catch(() => null);
  rebuildTray();
  return chatModels;
}

// A cue from the brain (or the tray, or a local script): the overlay acts it
// out. A line to speak gets its audio here first, so it arrives with its voice.
function toOverlay(cue) {
  if (overlay && !overlay.isDestroyed() && !overlay.webContents.isDestroyed()) overlay.webContents.send('reze:cue', cue);
}

async function handleCue(cue) {
  if (!cue || !overlay) return;
  console.log('[capri] cue:', JSON.stringify(cue).slice(0, 160));
  toOverlay(cue); // the line shows at once; its voice follows when the gateway has made it
  if (cue.kind === 'speak') {
    const audio = await reze.speak(brain, cue.text).catch((err) => {
      console.error('[capri] her voice failed:', err.message);
      return null;
    });
    if (audio) { console.log(`[capri] voice: ${Math.round(audio.length * 0.75 / 1024)} KB`); toOverlay({ kind: 'speak-audio', audio }); }
  }
}

// Her own words (2026-10-27, Dennis: "she should talk on her own too"): the
// brain is asked for one line as her, with the occasion in brackets, and the
// line is shown and spoken like a pushed one. Occasions: 'hello' when she
// comes up on the desk, and what the overlay reports about the machine (the
// battery running low, too many windows). One at a time, never more than one
// a minute, so she comments, not nags.
let lastOwnLine = 0;
let helloPromise = null; // { text, audio } once the brain has written and voiced her hello
async function ownLine(occasion, { minGapMs = 60000 } = {}) {
  if (!overlay || Date.now() - lastOwnLine < minGapMs) return;
  lastOwnLine = Date.now();
  try {
    const text = await reze.chat(brain, {
      model: pickModel(),
      messages: [{ role: 'user', content: `(not him talking: ${occasion}. Say one short line of your own, out loud, as yourself. No question back unless it fits.)` }],
    }, null, AbortSignal.timeout(60000));
    const line = String(text || '').trim();
    if (line) await handleCue({ kind: 'speak', text: line });
  } catch (err) {
    console.error('[capri] her own line failed:', err.message);
  }
}

// Her hello, written and voiced by the brain, fetched as soon as the app is up so it can land
// on the intro's "hi" (Dennis: "what if she said hey when she covers the entire screen at
// intro"). The first start of a day is the morning line: a greeting with the one thing that
// matters today, which the brain knows from his calendars. CAPRI_QUIET=1 skips it.
function fetchHello() {
  if (process.env.CAPRI_QUIET) return Promise.resolve(null);
  const today = new Date().toISOString().slice(0, 10);
  const first = config.load().lastDeskDay !== today;
  config.save({ lastDeskDay: today });
  const occasion = first
    ? 'first time at his desk today, you are grabbing his whole screen to say hi: one short excited greeting, then in the same breath the one thing that matters today if you know it (a class, an exam, something due); if nothing does, say it is a free one'
    : 'you are grabbing his whole screen to say hi after a restart: one short excited greeting, as yourself';
  lastOwnLine = Date.now();
  return (async () => {
    const text = String(await reze.chat(brain, {
      model: pickModel(),
      messages: [{ role: 'user', content: `(not him talking: ${occasion}. One line, out loud, as yourself.)` }],
    }, null, AbortSignal.timeout(45000)) || '').trim();
    if (!text) return null;
    console.log('[capri] hello:', text.slice(0, 120));
    const audio = await reze.speak(brain, text).catch(() => null);
    return { text, audio };
  })().catch((err) => { console.error('[capri] her hello failed:', err.message); return null; });
}

function relink() {
  brain = reze.settings(config.load());
  link?.stop();
  link = new reze.Link({ url: brain.runtime, token: brain.token });
  link.on('cue', handleCue);
  link.on('state', ({ linked }) => {
    const why = !linked && link.lastClose ? ` (close ${link.lastClose.code} ${link.lastClose.reason})` : '';
    console.log(`[capri] ${new Date().toISOString().slice(11, 19)} brain ${linked ? 'linked' : 'away'}: ${brain.runtime}${why}`);
    rebuildTray();
    toOverlay({ kind: 'link', linked });

  });
  link.on('error', (err) => console.error('[capri] link:', err.message));
  link.start();
  refreshModels();
}

// System notification for Claude events: what she says, as a native notification.
function notifyUser(line, tag) {
  const cfg = config.load();
  if (!cfg.notifications) return;
  if (!Notification.isSupported()) return;
  const notif = new Notification({
    title: tag ? `Capri — ${tag}` : 'Capri',
    body: String(line || '').slice(0, 200),
    silent: true, // her own sounds are enough
  });
  notif.show();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icons', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Capri');
  tray.on('click', () => sendCommand('status'));
  rebuildTray();
}

function registerIpc() {
  ipcMain.on('overlay:interactive', (_e, on) => {
    overlay?.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.handle('overlay:cursor', () => {
    const p = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    return { x: p.x - b.x, y: p.y - b.y, inside: p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height };
  });
  ipcMain.handle('config:get', () => rendererConfig());
  ipcMain.handle('hooks:status', () => ({ installed: true, file: '' })); // her guide still asks; the brain is the hook now
  ipcMain.handle('config:set', (_e, patch) => updateConfig(patch));
  ipcMain.handle('demo:window', (_e, open) => demoWindow(open));
  // right-clicking her: the same menu as the tray icon (which Windows often hides behind the ^ by the clock)
  ipcMain.on('menu:open', () => trayMenu?.popup({ window: overlay }));
  // her welcome panel's buttons
  ipcMain.handle('hooks:install', () => ({ action: 'install', ok: true, file: '' }));
  ipcMain.handle('claude:found', () => true);
  ipcMain.on('claude:help', () => shell.openExternal(brain.origin));
  ipcMain.handle('windows:get', () => lastWindows);
  // talking to her (chat.js): is the brain there, with someone on the roster
  ipcMain.handle('chat:status', async () => {
    const models = await refreshModels();
    if (!models) return { ok: false, error: 'offline' };
    if (!models.length) return { ok: false, error: 'nomodel' };
    return { ok: true, model: pickModel() };
  });
  // the overlay saw something about the machine worth a word from her
  ipcMain.on('brain:occasion', (_e, occasion) => { if (typeof occasion === 'string' && occasion.length < 200) ownLine(occasion, { minGapMs: 20 * 60000 }); });
  // the overlay asks for her hello before the intro and waits up to `waitMs` for it; null when
  // it is late (the overlay then plays it whenever it comes) or quiet
  ipcMain.handle('brain:hello', async (_e, waitMs) => {
    if (!helloPromise) return null;
    const late = new Promise((r) => setTimeout(() => r(undefined), Math.max(0, Number(waitMs) || 0)));
    const got = await Promise.race([helloPromise, late]);
    if (got !== undefined) return got;
    helloPromise.then((h) => { if (h) toOverlay({ kind: 'hello', ...h }); });
    return null;
  });
  ipcMain.handle('brain:status', () => ({ linked: Boolean(link?.linked), origin: brain.origin, model: pickModel(), voice: brain.voice }));
  // her voice for a line she wrote herself (a chat answer): mp3 as base64, or null
  ipcMain.handle('brain:voice', (_e, text) => reze.speak(brain, text).catch((err) => {
    console.error('[capri] her voice failed:', err.message);
    return null;
  }));
  // her answer, streamed to the overlay piece by piece as `chat:delta`
  ipcMain.handle('chat:send', async (_e, { id, messages }) => {
    const abort = new AbortController();
    chats.set(id, abort);
    try {
      const send = (text) => overlay?.webContents.send('chat:delta', { id, text });
      const text = await reze.chat(brain, { model: pickModel(), messages }, send, abort.signal);
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: abort.signal.aborted ? 'stopped' : err.message };
    } finally {
      chats.delete(id);
    }
  });
  ipcMain.on('chat:stop', (_e, id) => chats.get(id)?.abort());
  ipcMain.on('chat:ollama', () => shell.openExternal(brain.origin));
  // closing an app you asked her to close, once you've clicked to confirm (apps.js)
  const appInfo = (app) => app && { name: app.process, label: app.label };
  ipcMain.handle('apps:list', async () => (await apps.list().catch(() => [])).map(appInfo));
  ipcMain.handle('apps:find', async (_e, wanted) => appInfo(await apps.find(wanted).catch(() => null)));
  ipcMain.handle('apps:close', (_e, { name, force }) => apps.close(name, { force }).catch((err) => ({ error: err.message })));
  // typing to her: the overlay takes the keyboard while the chat is open, and gives it back after
  ipcMain.on('overlay:focus', (_e, on) => {
    if (!overlay) return;
    overlay.setFocusable(Boolean(on));
    if (on) overlay.focus();
    else overlay.blur();
  });
  // her report card's copy button: a picture of that part of the overlay, on the clipboard
  ipcMain.handle('panel:copy', async (_e, rect) => {
    const image = await overlay.webContents.capturePage(rect);
    if (image.isEmpty()) return false;
    const png = new Blob([image.toPNG()], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  });
  ipcMain.handle('focus:get', () => focus.state);
  // her focus-times window: what's saved, the limits, and its words in her language
  ipcMain.handle('focus:times', () => {
    const cfg = config.load();
    const lang = resolveLang(cfg.lang);
    // only words cross to the window (functions can't): timesBad as a template
    const words = Object.fromEntries(Object.entries(TRAY[lang]).filter(([, v]) => typeof v === 'string'));
    return { times: cfg.focusCustom, limits: LIMITS, lang, labels: { ...words, timesBad: TRAY[lang].timesBad('{min}', '{max}') } };
  });
  ipcMain.handle('focus:saveTimes', (_e, times, start) => {
    const checked = checkTimes(times);
    if (!checked.ok) return checked;
    updateConfig({ focusCustom: checked.times });
    if (start) focus.start('custom');
    timesWin?.close();
    return checked;
  });
  ipcMain.on('focus:closeTimes', () => timesWin?.close());
  // her guide: where her tray icon is (it lives in the taskbar, off the overlay, hence overlay
  // coordinates past its edge), and the corner by the clock in case Windows hid it behind the ^
  ipcMain.handle('guide:tray', () => {
    const o = overlay.getBounds();
    const d = targetDisplay().bounds;
    const b = tray?.getBounds();
    const icon = b && b.width > 0 ? { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height } : null;
    const corner = { x: d.x + d.width - 150 - o.x, y: d.y + d.height - 44 - o.y, w: 140, h: 40 };
    return { icon, corner };
  });
  // her guide once took you to Claude Code's settings folder; the brain lives on the box now
  ipcMain.handle('guide:claudeFolder', () => {
    shell.openExternal(brain.origin);
    return { found: true, dir: brain.origin, file: false };
  });
  ipcMain.handle('sounds:list', () => {
    try {
      return fs.readdirSync(userSoundsDir())
        .filter((f) => SOUND_EXT.test(f))
        .map((f) => ({ name: f.replace(SOUND_EXT, '').toLowerCase(), url: `capri://usersounds/${encodeURIComponent(f)}` }));
    } catch {
      return [];
    }
  });
}

// Only in --dev: lets scripts drive the overlay and grab frames of it (no desktop content, just our window).
const testWins = new Map(); // name -> test window

async function debugHandler(route, body = {}) {
  if (!DEV) throw new Error('debug routes need --dev');
  if (!overlay || overlay.isDestroyed()) throw new Error('no overlay');
  if (route === 'command') {
    sendCommand(body.name, body);
    return { ok: true };
  }
  if (route === 'focus') {
    // { do: 'start' | 'pause' | 'resume' | 'skip' | 'stop', preset }: as from her menu
    if (typeof focus[body.do] !== 'function') throw new Error('unknown focus action');
    focus[body.do](body.preset);
    return { ok: true, state: focus.state };
  }
  if (route === 'focustimes') {
    // her "Set my own times" window: { open: true } opens it; { capture } saves a frame of it
    if (body.open) openFocusTimes();
    if (body.capture && timesWin) {
      const image = await timesWin.webContents.capturePage();
      const dir = path.join(app.isPackaged ? app.getPath('userData') : ROOT, 'captures');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${String(body.capture).replace(/[^\w-]/g, '')}.png`);
      fs.writeFileSync(file, image.toPNG());
      return { ok: true, file };
    }
    return { ok: true };
  }
  if (route === 'reload') {
    overlay.webContents.reloadIgnoringCache();
    return { ok: true };
  }
  if (route === 'testwin') {
    // plain windows to sit on, opened without stealing focus, by name (`id`, default "main");
    // each one opened goes in front of the others. { open: false } without an id closes them all.
    const id = body.id ?? 'main';
    if (!body.open && body.id === undefined) {
      for (const win of testWins.values()) win.destroy();
      testWins.clear();
      return { ok: true };
    }
    testWins.get(id)?.destroy();
    testWins.delete(id);
    if (body.open) {
      const b = overlay.getBounds();
      const win = new BrowserWindow({
        x: b.x + (body.x ?? 300), y: b.y + (body.y ?? 380), width: body.w ?? 720, height: body.h ?? 380,
        show: false, alwaysOnTop: true, title: `Capri test window ${id}`, backgroundColor: '#1b1726',
      });
      win.loadURL('data:text/html,<body style="background:%231b1726"></body>');
      win.showInactive();
      testWins.set(id, win);
    }
    return { ok: true };
  }
  if (route === 'movewin' && testWins.has(body.id ?? 'main')) {
    const win = testWins.get(body.id ?? 'main');
    const [x, y] = win.getPosition();
    win.setPosition(x + (body.dx || 0), y + (body.dy || 0));
    return { ok: true };
  }
  if (route === 'mouse') {
    // the pointer moving over the overlay (css px), and clicking if asked, without touching the real one
    const at = { x: Math.round(body.x), y: Math.round(body.y) };
    overlay.webContents.sendInputEvent({ type: 'mouseMove', ...at });
    if (body.click) {
      overlay.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at });
      overlay.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at });
    }
    return { ok: true };
  }
  if (route === 'state') {
    // where she is and what she is doing, from the renderer (app.js exposes it in --dev)
    const state = await overlay.webContents.executeJavaScript('window.__capriState ? window.__capriState() : null');
    return { ok: true, state };
  }
  if (route === 'drag') {
    // a drag of the pointer over the overlay: down at `from`, `steps` moves over `ms`, up at `to`
    if (!body.from || !body.to) throw new Error('drag needs from and to');
    const from = { x: Math.round(body.from.x), y: Math.round(body.from.y) };
    const to = { x: Math.round(body.to.x), y: Math.round(body.to.y) };
    const steps = Math.max(2, Number(body.steps) || 8);
    const ms = Math.max(20, Number(body.ms) || 160);
    const pause = (t) => new Promise((r) => setTimeout(r, t));
    overlay.webContents.sendInputEvent({ type: 'mouseMove', ...from });
    overlay.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...from });
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      overlay.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x + (to.x - from.x) * k), y: Math.round(from.y + (to.y - from.y) * k), buttons: 1 });
      await pause(ms / steps);
    }
    overlay.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...to });
    return { ok: true };
  }
  if (route === 'type') {
    // typing into the overlay (her chat), and Enter if asked
    if (body.text) await overlay.webContents.insertText(body.text);
    if (body.enter) {
      overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      overlay.webContents.sendInputEvent({ type: 'char', keyCode: 'Return' });
      overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    }
    return { ok: true };
  }
  if (route === 'capture') {
    const image = await overlay.webContents.capturePage();
    // installed, the app's own folder is read-only: its data folder instead
    const dir = path.join(app.isPackaged ? app.getPath('userData') : ROOT, 'captures');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${(body.name || 'frame').replace(/[^\w-]/g, '')}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file };
  }
  throw new Error('unknown debug route');
}

function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => sendCommand('status'));
  if (process.platform === 'win32') app.setAppUserModelId('capri.shell');

  app.whenReady().then(() => {
    serveProtocol();
    registerIpc();
    createOverlay();
    createTray();
    windowWatch = startWindowWatch({
      overlay,
      onUpdate: (data) => {
        lastWindows = data;
        overlay?.webContents.send('windows:update', data);
      },
    });
    createBridge({
      port: PORT,
      onCue: handleCue,
      onEvent: (evt) => {
        overlay?.webContents.send('claude:event', evt);
        // System notification for key Claude events
        const name = evt.hook_event_name;
        if (name === 'Notification' && (evt.notification_type === 'permission_prompt' || evt.notification_type === 'elicitation_dialog')) {
          notifyUser(evt.message || 'Claude needs your permission.', 'ALERT');
        } else if (name === 'Stop') {
          const quote = String(evt.last_assistant_message || '').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
          notifyUser(quote.slice(0, 150) || 'Claude finished.', 'DONE');
        } else if (name === 'PostToolUseFailure') {
          notifyUser(`${evt.tool_name || 'Tool'} failed: ${(evt.error || '').split('\n')[0]}`, 'ERROR');
        }
      },
      onDebug: DEV ? debugHandler : null,
    });
    globalShortcut.register('Control+Alt+C', () => toggleVisible());
    relink(); // the brain: cues in, chat and voice out
    helloPromise = fetchHello(); // her first words, ready for the intro's "hi"
    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', () => { fitOverlay(); rebuildTray(); });
    screen.on('display-removed', () => { fitOverlay(); rebuildTray(); });
  });

  app.on('before-quit', () => console.log(`[capri] ${new Date().toISOString().slice(11, 19)} quitting`));
  process.on('exit', (code) => console.log(`[capri] exit ${code}`));
  app.on('child-process-gone', (_e, d) => console.error('[capri] child process gone:', d.type, d.reason));
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    windowWatch?.stop();
    link?.stop();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
