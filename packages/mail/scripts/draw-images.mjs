#!/usr/bin/env node
/*
 * Draws the pictures Alcove's emails carry, at twice the size they're shown, and writes them into the package: the PNGs to
 * assets/, and base64 into src/images.ts, since the API's bundle carries no files of a package's and an email fetches
 * nothing when it's opened.
 *
 * The picture is the Team page's evening (its moment `team`: the sun low on the left, on the horizon) as an email's head,
 * with Alcove's logo at its top left as on the page that joins a team (JoinEvening), by day and by night. It's drawn with
 * the app's own stylesheet for the scene (packages/ui/src/evening/horizon.css), so its colours are the evening's, and the
 * logo in its own typeface (packages/ui/src/fonts). What's laid out here (where the sun, the clouds and the light on the
 * water are) is the scene's drawing (horizon.tsx) sized for a 560px email rather than a window.
 *
 *   pnpm --filter @alcove/mail images
 *
 * It runs Google Chrome headless and muted, through the DevTools protocol (CHROME=/path/to/chrome for another one).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* ------------------------------------------------------------ the evening, as an email's head */
/** Shown 560 × 200, the email's width; drawn at twice that. */
const W = 560;
const H = 200;
const SCALE = 2;
/** Where the sky meets the sea, and where the sun stands on it: low and to the left, as on Team. */
const HZ = 150;
const SUN_X = 150;
const SUN_R = 25;

/** A small generator, so the picture is the same each time it's drawn (horizon.tsx's). */
function seeded(seed) {
  let n = seed;
  return () => { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; };
}

/** The sun's light on the water: stripes under it, wider and further apart the nearer they come (horizon.tsx's drawSea). */
function glints(depth) {
  const r = seeded(7);
  const out = [];
  for (let y = 5; y < depth; y += 6) {
    const far = y / depth;
    const spread = 9 + far * 40;
    const n = 1 + Math.round(r() * 2);
    for (let i = 0; i < n; i++) {
      const w = (6 + r() * 20) * (0.7 + far) * 1.3;
      const off = (r() - 0.5) * 2 * spread;
      out.push({ x: off - w / 2, y, w, o: 0.86 - far * 0.6, far });
    }
  }
  return out;
}

/** The chop: faint strokes across the water, none in the sun's path. */
function chop(rows) {
  const r = seeded(19);
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let k = 0; k < 7; k++) {
      const w = 16 + r() * 46;
      const x = -W / 2 - 20 + r() * (W + 40);
      if (Math.abs(x + w / 2 - (SUN_X - W / 2)) < 48) continue;
      out.push({ x, y: 9 + row * 12, w, o: 0.05 + r() * 0.09 });
    }
  }
  return out;
}

/** A cloud as the sun's own stripes draw it: thin bars, widest at the bottom, where the last light catches them. */
function cloud({ w, rows }, seed) {
  const r = seeded(seed);
  return Array.from({ length: rows }, (_, i) => {
    const up = i / rows;
    const width = w * Math.pow(1 - up, 0.75) * (0.82 + r() * 0.3);
    return { x: (w - width) * (0.25 + r() * 0.5), y: -i * 7, w: width, lit: 1 - up };
  });
}

/** Where each cloud rests: across the picture (%) and up the sky (a share of it). Clear of the logo, at the top left. */
const CLOUDS = [{ x: 71, at: 0.3, w: 136, rows: 5 }, { x: 37, at: 0.15, w: 84, rows: 3 }, { x: 4, at: 0.62, w: 104, rows: 4 }];
/** Streaks low over the horizon, from the middle of the picture; the lowest crosses the sun. */
const STREAKS = [{ x: -236, y: -47, w: 196, o: 0.5 }, { x: 34, y: -31, w: 150, o: 0.4 }, { x: -168, y: -16, w: 214, o: 0.35 }];

/** Alcove's mark, as `Mark` draws it (packages/ui/src/foundation/brand.tsx): an arched window, the sun coming up in it. */
const MARK = `<svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true">
  <defs>
    <clipPath id="a"><path d="M2 24.6V11a9 9 0 0 1 18 0v13.6z"/></clipPath>
    <clipPath id="u"><rect x="0" y="0" width="22" height="19.2"/></clipPath>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2373"/><stop offset=".42" stop-color="#5847DA"/><stop offset=".64" stop-color="#C470A9"/><stop offset=".74" stop-color="#FFA06A"/></linearGradient>
    <radialGradient id="n" cx=".42" cy=".38" r=".72"><stop offset="0" stop-color="#FFF6E0"/><stop offset=".5" stop-color="#FFD58A"/><stop offset="1" stop-color="#FFB547"/></radialGradient>
    <radialGradient id="g"><stop offset="0" stop-color="#FFD58A" stop-opacity=".85"/><stop offset="1" stop-color="#FF9E5E" stop-opacity="0"/></radialGradient>
  </defs>
  <g clip-path="url(#a)">
    <rect width="22" height="26" fill="url(#s)"/>
    <g clip-path="url(#u)"><circle cx="11" cy="19.2" r="7.8" fill="url(#g)"/><circle cx="11" cy="19.2" r="4.4" fill="url(#n)"/></g>
    <rect y="19.2" width="22" height="7" fill="#231C5E"/>
    <rect x="7.2" y="20.5" width="7.6" height=".9" rx=".45" fill="#FFB36E" opacity=".8"/>
    <rect x="8.8" y="22.1" width="4.4" height=".8" rx=".4" fill="#FFB36E" opacity=".45"/>
  </g>
  <path d="M2 24.6V11a9 9 0 0 1 18 0v13.6z" fill="none" stroke="rgb(255 255 255 / .2)" stroke-width="1"/>
</svg>`;

const px = (n) => `${Math.round(n * 100) / 100}px`;

/** The page Chrome draws: the scene as Horizon lays it out, with the app's classes, still, and the logo over it. */
function page(night) {
  const ui = here('../../ui/src/');
  const horizon = readFileSync(join(ui, 'evening/horizon.css'), 'utf8');
  const font = pathToFileURL(join(ui, 'fonts/hanken-grotesk-latin.woff2')).href;
  const sun = SUN_X - W / 2;
  const sea = H - HZ;
  const puffs = CLOUDS.map((c, i) => `<div class="hz-puff" style="top:${px(HZ * c.at)}"><div style="left:${c.x}%">${cloud(c, 61 + i * 17).map((b) => `<i style="left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};--lit:${b.lit}"></i>`).join('')}</div></div>`).join('');
  const streaks = STREAKS.map((s) => `<i class="hz-cloud" style="left:${px(s.x)};top:${px(s.y)};width:${px(s.w)};opacity:${s.o}"></i>`).join('');
  const strokes = chop(4).map((c) => `<i style="left:${px(c.x)};top:${px(c.y)};width:${px(c.w)};opacity:${c.o.toFixed(3)}"></i>`).join('');
  const light = glints(sea).map((g) => `<i class="hz-glint" style="left:${px(g.x)};top:${px(g.y)};width:${px(g.w)};--o:${g.o.toFixed(3)};--far:${g.far.toFixed(3)}"></i>`).join('');
  return `<!doctype html><html class="${night ? 'dark' : ''}"><head><meta charset="utf-8"><style>
@font-face { font-family: 'Hanken Grotesk'; font-weight: 400 700; src: url('${font}') format('woff2'); }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
${horizon}
/* Still: the scene's resting picture, which is its drawing. */
*, *::before, *::after { animation: none !important; transition: none !important; }
.frame { --hz: ${HZ}px; position: relative; isolation: isolate; width: ${W}px; height: ${H}px; overflow: hidden; }
.frame .hz { --hz-sun-x: ${sun}px; --hz-sun-r: ${SUN_R}px; --hz-glow-w: 700px; --hz-glow-h: 196px; }
/* The sea as deep as a page's, so this band is the top of it. */
.frame .hz-sea { bottom: auto; height: ${sea * 4}px; }
.frame .hz-rim { left: ${px(sun - 330)}; width: 660px; }
/* A phone's sky hides its clouds (horizon.css), and this page is as narrow as one: this sky keeps them. */
.frame .hz-puff { display: block; }
.logo { position: absolute; top: 22px; left: 24px; display: inline-flex; align-items: center; gap: 9px; font: 650 21px/1 'Hanken Grotesk'; letter-spacing: -.055em; color: ${night ? '#F7F3EB' : '#12223F'}; }
.logo svg { flex: none; }
</style></head><body><div class="frame">
<div class="hz" data-moment="team" aria-hidden="true">
<div class="hz-sky"></div><div class="hz-sea"></div>
<div class="hz-up"><div class="hz-stars"></div><div class="hz-light"><i class="hz-glow"></i><i class="hz-sun"></i></div>${puffs}</div>
<div class="hz-at">${streaks}<i class="hz-rim"></i><div class="hz-chop">${strokes}</div></div>
<div class="hz-light">${light}</div>
</div>
<span class="logo">${MARK}alcove</span>
</div></body></html>`;
}

/* ------------------------------------------------------------ Chrome, through the DevTools protocol */
async function chrome() {
  const profile = mkdtempSync(join(tmpdir(), 'alcove-mail-'));
  const proc = spawn(CHROME, ['--headless=new', '--mute-audio', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  const url = await new Promise((resolve, reject) => {
    let said = '';
    proc.stderr.on('data', (d) => { said += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(said); if (m) resolve(m[1]); });
    proc.once('error', reject);
    exited.then((code) => reject(new Error(`Chrome stopped (${code}) before it listened. Is it at ${CHROME}? Set CHROME to its path.\n${said}`)));
  });
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0;
  const waiting = new Map();
  const events = new Set();
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    const w = msg.id ? waiting.get(msg.id) : undefined;
    if (w) { waiting.delete(msg.id); if (msg.error) w.reject(new Error(`${w.method}: ${msg.error.message}`)); else w.resolve(msg.result); }
    else for (const on of events) on(msg);
  };
  const send = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const event = (method, sessionId) => new Promise((resolve) => {
    const on = (msg) => { if (msg.method === method && msg.sessionId === sessionId) { events.delete(on); resolve(msg.params); } };
    events.add(on);
  });
  return {
    /** The page drawn at `scale`, `width` × `height` from its top left, as a PNG. */
    async draw(html, width, height, scale) {
      const file = join(profile, 'page.html');
      writeFileSync(file, html);
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
      const loaded = event('Page.loadEventFired', sessionId);
      await send('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
      await loaded;
      await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => document.fonts.size)', awaitPromise: true }, sessionId);
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } }, sessionId);
      await send('Target.closeTarget', { targetId });
      return Buffer.from(shot.data, 'base64');
    },
    async close() {
      try { await send('Browser.close'); } catch { /* it's gone already */ }
      ws.close();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
      if (proc.exitCode === null) { proc.kill(); await exited; }
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  };
}

/* ------------------------------------------------------------ drawing them, and writing them in */
const PICTURES = [
  { name: 'EVENING', file: 'evening.png', night: false, says: 'The Team page’s evening, the sun low on the left, with Alcove’s logo at its top left: by day.' },
  { name: 'EVENING_NIGHT', file: 'evening-night.png', night: true, says: 'The same evening by night, for mail that’s dark.' }
];

const browser = await chrome();
const drawn = [];
try {
  for (const p of PICTURES) {
    const png = await browser.draw(page(p.night), W, H, SCALE);
    writeFileSync(here(`../assets/${p.file}`), png);
    drawn.push({ ...p, png });
    process.stdout.write(`assets/${p.file}: ${W * SCALE} × ${H * SCALE}, ${(png.length / 1024).toFixed(1)} KB\n`);
  }
} finally {
  await browser.close();
}

const source = `/*
 * Generated by scripts/draw-images.mjs from assets/ (\`pnpm --filter @alcove/mail images\`): draw them again rather than
 * edit this. The pictures Alcove's emails carry, base64, so the API's bundle has them and an email fetches nothing.
 */

/** A picture an email carries: its file's name, its size in pixels (twice what it's shown at), and the PNG, base64. */
export interface Picture { filename: string; width: number; height: number; content: string }

${drawn.map((p) => `/** ${p.says} */\nexport const ${p.name}: Picture = { filename: 'alcove-${p.file}', width: ${W * SCALE}, height: ${H * SCALE}, content: '${p.png.toString('base64')}' };`).join('\n\n')}
`;
writeFileSync(here('../src/images.ts'), source);
process.stdout.write(`src/images.ts: ${(source.length / 1024).toFixed(1)} KB\n`);
