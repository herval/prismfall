/* Prismfall — a falling-gem puzzle with a tilting board.
   Vanilla JS + Canvas 2D + WebAudio. No dependencies. */
(() => {
'use strict';

// ============================================================ constants
const COLS = 7, ROWS = 14, HIDDEN = 2, TOTAL = ROWS + HIDDEN;
const PRISM = 99;
const METER_MAX = 30;
const LOCK_DELAY = 0.5, MAX_LOCK_RESETS = 15;
const CLEAR_TIME = 0.36;
const GEMS = [
  { name: 'ruby',   hex: '#ff3d6e', light: '#ffd0dc', dark: '#7d0628', shape: 'diamond' },
  { name: 'amber',  hex: '#ffb21e', light: '#fff3c4', dark: '#8a4300', shape: 'circle' },
  { name: 'jade',   hex: '#22e39a', light: '#caffe8', dark: '#005c39', shape: 'triangle' },
  { name: 'azure',  hex: '#3f86ff', light: '#d3e3ff', dark: '#0b2a80', shape: 'square' },
  { name: 'violet', hex: '#b45cff', light: '#efd9ff', dark: '#43097f', shape: 'hex' },
  { name: 'ice',    hex: '#38e8ff', light: '#dcfcff', dark: '#00607a', shape: 'star' },
];
const SHAPES = {
  I: [[0, -1], [0, 0], [0, 1]],
  L: [[0, -1], [0, 0], [1, 0]],
  P: [[0, 0]],
};
const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [-1, -1], [1, -1]];

const $ = id => document.getElementById(id);
const body = document.body;
const canvas = $('game'), ctx = canvas.getContext('2d');
const nextCv = $('next'), nctx = nextCv.getContext('2d');
const store = {
  get(k, d) { try { const v = localStorage.getItem('prismfall.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('prismfall.' + k, JSON.stringify(v)); } catch {} },
};
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
const vibrate = p => { if (settings.haptics && navigator.vibrate) try { navigator.vibrate(p); } catch {} };

const settings = { music: store.get('music', true), sfx: store.get('sfx', true), haptics: true };

// ============================================================ audio
const Sound = (() => {
  let ac = null, master, sfxBus, musicBus, reverb, noiseBuf;
  let seqTimer = null, nextNoteTime = 0, step = 0, tempo = 92;
  // A minor pentatonic-ish palette
  const midi = m => 440 * Math.pow(2, (m - 69) / 12);
  const PENTA = [0, 3, 5, 7, 10];
  const scaleNote = (i, base = 69) => midi(base + PENTA[((i % 5) + 5) % 5] + 12 * Math.floor(i / 5));
  const CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 67]]; // Am7 Fmaj7 C G

  function impulse(sec) {
    const len = ac.sampleRate * sec, buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ac.destination);
    reverb = ac.createConvolver(); reverb.buffer = impulse(2.4);
    const wet = ac.createGain(); wet.gain.value = 0.32; reverb.connect(wet); wet.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = settings.sfx ? 1 : 0; sfxBus.connect(master); sfxBus.connect(reverb);
    musicBus = ac.createGain(); musicBus.gain.value = settings.music ? 0.55 : 0; musicBus.connect(master); musicBus.connect(reverb);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }
  function tone(freq, o = {}) {
    if (!ac) return;
    const t = ac.currentTime + (o.t || 0), dur = o.dur || 0.2;
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    if (o.detune) osc.detune.value = o.detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol || 0.2, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    node.connect(g); g.connect(o.dest || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(o = {}) {
    if (!ac) return;
    const t = ac.currentTime + (o.t || 0), dur = o.dur || 0.2;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = o.ftype || 'bandpass'; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.freq || 1200, t);
    if (o.slide) f.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol || 0.2, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    src.start(t); src.stop(t + dur + 0.05);
  }
  let lastTick = 0;
  const S = {
    init,
    move() { tone(880, { dur: 0.05, type: 'triangle', vol: 0.05 }); },
    rotate() { tone(1320, { dur: 0.07, type: 'sine', vol: 0.08, slide: 1760 }); },
    cycle() { [0, 1, 2].forEach(i => tone(scaleNote(8 + i), { t: i * 0.035, dur: 0.12, type: 'triangle', vol: 0.07 })); },
    soft() { tone(300, { dur: 0.03, type: 'triangle', vol: 0.03 }); },
    hard() { tone(140, { dur: 0.25, type: 'sine', vol: 0.4, slide: 50 }); noise({ dur: 0.18, vol: 0.25, freq: 900, slide: 200, ftype: 'lowpass' }); },
    lock() { tone(520, { dur: 0.08, type: 'triangle', vol: 0.09 }); noise({ dur: 0.05, vol: 0.06, freq: 3000 }); },
    land() {
      if (!ac || ac.currentTime - lastTick < 0.04) return; lastTick = ac.currentTime;
      tone(rand(600, 760), { dur: 0.05, type: 'triangle', vol: 0.05 });
    },
    clear(chain, n) {
      const base = 2 + chain * 2;
      const count = Math.min(3 + Math.floor(n / 3), 7);
      for (let i = 0; i < count; i++) tone(scaleNote(base + i), { t: i * 0.045, dur: 0.5, type: i % 2 ? 'sine' : 'triangle', vol: 0.11 });
      tone(scaleNote(base + count + 2), { t: count * 0.045, dur: 0.9, type: 'sine', vol: 0.08 });
    },
    pop() { noise({ dur: 0.12, vol: 0.12, freq: 4200, q: 0.8 }); },
    line(n) {
      noise({ dur: 0.7, vol: 0.22, freq: 400, slide: 6000, q: 2 });
      [0, 4, 7, 12].forEach((s, i) => tone(midi(69 + s + n * 2), { t: 0.05 + i * 0.06, dur: 1.1, type: 'sawtooth', vol: 0.05, lp: 2400 }));
    },
    prism() {
      for (let i = 0; i < 14; i++) tone(scaleNote(10 + (i * 3) % 12), { t: i * 0.03, dur: 0.4, type: 'sine', vol: 0.07 });
      noise({ dur: 1.2, vol: 0.18, freq: 8000, slide: 1500, q: 3 });
    },
    tilt() {
      noise({ dur: 0.9, vol: 0.35, freq: 200, slide: 2400, q: 1.5, attack: 0.25 });
      tone(55, { dur: 1.0, type: 'sawtooth', vol: 0.18, slide: 110, lp: 600 });
    },
    ready() { [0, 2, 4, 7].forEach((s, i) => tone(scaleNote(10 + s), { t: i * 0.07, dur: 0.6, type: 'triangle', vol: 0.09 })); },
    level() { [0, 4, 7, 11, 14].forEach((s, i) => tone(midi(64 + s), { t: i * 0.08, dur: 0.9, type: 'triangle', vol: 0.1 })); },
    over() {
      [12, 10, 7, 5, 3, 0].forEach((s, i) => tone(midi(57 + s), { t: i * 0.14, dur: 0.7, type: 'triangle', vol: 0.12 }));
      tone(55, { t: 0.2, dur: 2.2, type: 'sawtooth', vol: 0.12, lp: 500, slide: 40 });
    },
    click() { tone(1000, { dur: 0.04, type: 'sine', vol: 0.07 }); },
    setSfx(on) { if (sfxBus) sfxBus.gain.value = on ? 1 : 0; },
    setMusic(on) { if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.55 : 0, ac.currentTime, 0.2); },
    setTempo(bpm) { tempo = bpm; },
    startMusic() {
      if (!ac || seqTimer) return;
      nextNoteTime = ac.currentTime + 0.1; step = 0;
      seqTimer = setInterval(schedule, 25);
    },
    stopMusic() { clearInterval(seqTimer); seqTimer = null; },
    suspend() { if (ac && ac.state === 'running') ac.suspend(); },
    resume() { if (ac && ac.state === 'suspended') ac.resume(); },
  };
  function schedule() {
    const spb = 60 / tempo / 2; // eighth notes
    while (nextNoteTime < ac.currentTime + 0.15) {
      const bar = Math.floor(step / 8) % 4, s = step % 8, ch = CHORDS[bar];
      const t = nextNoteTime - ac.currentTime;
      if (s === 0) {
        ch.forEach(m => tone(midi(m), { t, dur: spb * 8.5, type: 'sine', vol: 0.028, attack: 0.5, dest: musicBus }));
        tone(midi(ch[0] - 12), { t, dur: spb * 3, type: 'triangle', vol: 0.09, dest: musicBus });
      }
      if (s === 4) tone(midi(ch[0] - 12), { t, dur: spb * 2, type: 'triangle', vol: 0.06, dest: musicBus });
      const arp = [0, 2, 1, 3, 2, 1, 3, 2][s];
      if (s !== 7 || Math.random() < 0.5)
        tone(midi(ch[arp] + 12), { t, dur: spb * 1.6, type: 'triangle', vol: 0.03 + (s % 2 ? 0 : 0.012), dest: musicBus, lp: 3000 });
      if (s % 2 === 1) noise({ t, dur: 0.03, vol: 0.012, freq: 9000, dest: musicBus });
      nextNoteTime += spb; step++;
    }
  }
  return S;
})();

// ============================================================ sprites
let DPR = 1, W = 0, H = 0, cell = 40, bx = 0, by = 0, bw = 0, bh = 0;
let sprites = [], whites = [], dots = [], prismFrames = [], prismWhite = null;
const PRISM_FRAMES = 24;

function shapePts(shape, r) {
  const poly = (n, rad, off = -Math.PI / 2) => Array.from({ length: n }, (_, i) => [Math.cos(off + i * 2 * Math.PI / n) * rad, Math.sin(off + i * 2 * Math.PI / n) * rad]);
  switch (shape) {
    case 'diamond': return [[0, -r * 1.02], [r * 0.84, 0], [0, r * 1.02], [-r * 0.84, 0]];
    case 'triangle': return [[0, -r * 1.08], [r * 1.0, r * 0.66], [-r * 1.0, r * 0.66]];
    case 'square': return [[-r * .8, -r * .8], [r * .8, -r * .8], [r * .8, r * .8], [-r * .8, r * .8]];
    case 'hex': return poly(6, r * 0.97);
    case 'octa': return poly(8, r * 0.98, -Math.PI / 2 + Math.PI / 8);
    case 'star': {
      const p = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.52 : r * 1.06;
        p.push([Math.cos(a) * rr, Math.sin(a) * rr + r * 0.06]);
      }
      return p;
    }
    default: return null;
  }
}
function tracePath(c, shape, r) {
  c.beginPath();
  if (shape === 'circle') { c.arc(0, 0, r * 0.9, 0, Math.PI * 2); return; }
  if (shape === 'square') {
    const s = r * 0.8, k = r * 0.28;
    c.moveTo(-s + k, -s); c.lineTo(s - k, -s); c.quadraticCurveTo(s, -s, s, -s + k);
    c.lineTo(s, s - k); c.quadraticCurveTo(s, s, s - k, s); c.lineTo(-s + k, s);
    c.quadraticCurveTo(-s, s, -s, s - k); c.lineTo(-s, -s + k); c.quadraticCurveTo(-s, -s, -s + k, -s);
    c.closePath(); return;
  }
  const p = shapePts(shape, r);
  c.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) c.lineTo(p[i][0], p[i][1]);
  c.closePath();
}
function makeGemSprite(g, size, fillOverride) {
  const S = Math.ceil(size * 1.5);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.translate(S / 2, S / 2);
  const r = size * 0.43, shape = g.shape;
  // outer glow
  c.save(); c.shadowColor = g.hex; c.shadowBlur = r * 0.75; c.fillStyle = g.hex; tracePath(c, shape, r); c.fill(); c.restore();
  // body
  const body = c.createLinearGradient(-r, -r, r, r);
  if (fillOverride) fillOverride(body); else { body.addColorStop(0, g.light); body.addColorStop(0.42, g.hex); body.addColorStop(1, g.dark); }
  c.fillStyle = body; tracePath(c, shape, r); c.fill();
  // bevel facets
  c.save(); tracePath(c, shape, r); c.clip();
  const shade = c.createLinearGradient(-r * 0.2, -r * 0.2, r, r);
  shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.38)');
  c.fillStyle = shade; c.fillRect(-r * 1.3, -r * 1.3, r * 2.6, r * 2.6);
  const pts = shape === 'circle' ? null : shapePts(shape, r);
  c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = Math.max(1, r * 0.05);
  if (pts) { c.beginPath(); pts.forEach(([x, y]) => { c.moveTo(x, y); c.lineTo(x * 0.55, y * 0.55); }); c.stroke(); }
  else { c.beginPath(); c.arc(0, 0, r * 0.5, 0, Math.PI * 2); c.stroke(); }
  c.restore();
  // table (inner facet)
  c.save(); c.scale(0.55, 0.55);
  const tb = c.createRadialGradient(-r * 0.35, -r * 0.5, 0, 0, 0, r * 1.2);
  tb.addColorStop(0, 'rgba(255,255,255,.85)'); tb.addColorStop(0.45, rgba(g.light, 0.45)); tb.addColorStop(1, rgba(g.hex, 0.1));
  c.fillStyle = tb; tracePath(c, shape, r); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = Math.max(1, r * 0.08); c.stroke();
  c.restore();
  // outline
  c.strokeStyle = rgba(g.light, 0.85); c.lineWidth = Math.max(1, r * 0.07); c.lineJoin = 'round';
  tracePath(c, shape, r); c.stroke();
  // specular
  c.save(); c.translate(-r * 0.34, -r * 0.44); c.rotate(-0.7);
  c.fillStyle = 'rgba(255,255,255,.9)'; c.beginPath(); c.ellipse(0, 0, r * 0.2, r * 0.09, 0, 0, Math.PI * 2); c.fill();
  c.restore();
  c.fillStyle = 'rgba(255,255,255,.45)'; c.beginPath(); c.arc(r * 0.3, r * 0.34, r * 0.06, 0, Math.PI * 2); c.fill();
  return cv;
}
function makeWhite(shape, size) {
  const S = Math.ceil(size * 1.5);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d'); c.translate(S / 2, S / 2);
  c.shadowColor = '#fff'; c.shadowBlur = size * 0.3; c.fillStyle = '#fff';
  tracePath(c, shape, size * 0.45); c.fill();
  return cv;
}
function makeDot(hex) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, rgba(hex, 0.9)); g.addColorStop(1, rgba(hex, 0));
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return cv;
}
function buildSprites() {
  const size = Math.round(cell * DPR);
  sprites = GEMS.map(g => makeGemSprite(g, size));
  whites = GEMS.map(g => makeWhite(g.shape, size));
  dots = GEMS.map(g => makeDot(g.hex));
  dots[PRISM] = makeDot('#ffffff');
  const pg = { hex: '#ffffff', light: '#ffffff', dark: '#6b5bd6', shape: 'octa' };
  prismFrames = [];
  for (let f = 0; f < PRISM_FRAMES; f++) {
    const h = f * 360 / PRISM_FRAMES;
    prismFrames.push(makeGemSprite({ ...pg, hex: `hsl(${h},100%,70%)` }, size, grad => {
      for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${(h + i * 60) % 360},100%,${i % 2 ? 62 : 78}%)`);
    }));
  }
  prismWhite = makeWhite('octa', size);
}
function spriteFor(c, t) { return c === PRISM ? prismFrames[Math.floor(t * 18) % PRISM_FRAMES] : sprites[c]; }
function whiteFor(c) { return c === PRISM ? prismWhite : whites[c]; }

// ============================================================ layout
const hud = $('hud'), controls = $('controls');
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  const top = hud.getBoundingClientRect().bottom + 10;
  const bottom = controls.getBoundingClientRect().top - 10;
  const availH = bottom - top, availW = Math.min(W, 520) - 28;
  const newCell = Math.max(16, Math.floor(Math.min(availW / COLS, availH / ROWS)));
  bw = newCell * COLS; bh = newCell * ROWS;
  bx = Math.round((W - bw) / 2); by = Math.round(top + (availH - bh) / 2);
  if (newCell !== cell || !sprites.length) { cell = newCell; buildSprites(); drawNext(); buildDemos(); }
  const nd = Math.min(DPR, 3);
  nextCv.width = 54 * nd; nextCv.height = 54 * nd;
  drawNext();
}

// ============================================================ game state
let grid = [];
let state = 'menu';   // menu | play | paused | over
let phase = 'idle';   // fall | settle | clear | tiltSlide | spawn | dying
let piece = null, nextPiece = null;
let score = 0, shownScore = 0, level = 1, gemsCleared = 0, rowsCleared = 0, meter = 0, chain = 0, maxChain = 0;
let dropTimer = 0, lockTimer = 0, lockResets = 0, phaseT = 0, tiltMode = false;
let tiltVis = 0, tiltTarget = 0, shake = 0, flashAll = 0, dangerLvl = 0;
let clearing = null, piecesSpawned = 0, piecesLocked = 0, meterWasFull = false;
let particles = [], texts = [], beams = [], bolts = [], rain = [], trails = [];
let best = store.get('best', 0);
let time = 0, sparkleT = 0;
let hintShown = false;

const makeGrid = () => Array.from({ length: TOTAL }, () => Array(COLS).fill(null));
const newGem = (c, x, y) => ({ c, x, y, vx: 0, vy: 0, flash: 0, pop: 0, clearing: false, rot: 0, vr: 0, alpha: 1 });
function forGems(fn) { for (let r = 0; r < TOTAL; r++) for (let c = 0; c < COLS; c++) if (grid[r][c]) fn(grid[r][c], r, c); }
const numColors = () => level >= 7 ? 6 : level >= 4 ? 5 : 4;
const interval = () => Math.max(0.06, 0.85 * Math.pow(0.85, level - 1));

function randomPiece() {
  if (level >= 2 && piecesSpawned > 8 && Math.random() < 0.04) return { kind: 'P', cells: [[0, 0]], colors: [PRISM] };
  const nc = numColors();
  const kind = Math.random() < 0.5 ? 'I' : 'L';
  let cols;
  do { cols = [0, 0, 0].map(() => Math.floor(Math.random() * nc)); }
  while (cols[0] === cols[1] && cols[1] === cols[2] && Math.random() < 0.85);
  return { kind, cells: SHAPES[kind].map(p => p.slice()), colors: cols };
}
function collides(cells, x, y) {
  for (const [dx, dy] of cells) {
    const cx = x + dx, cy = y + dy;
    if (cx < 0 || cx >= COLS || cy >= TOTAL) return true;
    if (cy >= 0 && grid[cy][cx]) return true;
  }
  return false;
}
function ghostDist() { let d = 0; while (!collides(piece.cells, piece.x, piece.y + d + 1)) d++; return d; }
const grounded = () => piece && collides(piece.cells, piece.x, piece.y + 1);
const canAct = () => state === 'play' && phase === 'fall' && piece;

function newGame() {
  grid = makeGrid();
  score = shownScore = 0; level = 1; gemsCleared = rowsCleared = meter = chain = maxChain = 0;
  piecesSpawned = piecesLocked = 0; meterWasFull = false;
  particles = []; texts = []; beams = []; bolts = []; trails = [];
  tiltVis = tiltTarget = shake = 0; tiltMode = false;
  piece = null; nextPiece = randomPiece();
  state = 'play';
  Sound.setTempo(92);
  updateHud(true);
  showScreen(null);
  body.classList.add('playing');
  requestAnimationFrame(resize);
  spawn();
  if (!store.get('seenHint', false)) { $('hint').classList.add('show'); hintShown = true; }
  if (settings.music) Sound.startMusic();
}

function spawn() {
  piece = nextPiece; nextPiece = randomPiece(); piecesSpawned++;
  const maxDy = Math.max(...piece.cells.map(c => c[1]));
  piece.x = 3; piece.y = HIDDEN - maxDy;
  piece.rx = piece.x; piece.ry = piece.y - 1.2;
  dropTimer = 0; lockTimer = 0; lockResets = 0;
  drawNext();
  if (collides(piece.cells, piece.x, piece.y)) { gameOver(); return; }
  phase = 'fall';
}

// ---------------------------------------------------------- actions
function move(dx) {
  if (!canAct()) return false;
  if (collides(piece.cells, piece.x + dx, piece.y)) return false;
  piece.x += dx; Sound.move(); afterMove(); return true;
}
function afterMove() { if (grounded() && lockResets < MAX_LOCK_RESETS) { lockTimer = 0; lockResets++; } }
function rotate(dir = 1) {
  if (!canAct() || piece.kind === 'P') return;
  const cells = piece.cells.map(([x, y]) => dir > 0 ? [-y, x] : [y, -x]);
  for (const [kx, ky] of KICKS) {
    if (!collides(cells, piece.x + kx, piece.y + ky)) {
      piece.cells = cells; piece.x += kx; piece.y += ky;
      Sound.rotate(); afterMove(); vibrate(4); return;
    }
  }
}
function cycleColors() {
  if (!canAct() || piece.kind === 'P') return;
  const c = piece.colors; piece.colors = [c[2], c[0], c[1]];
  piece.cycleFx = 1;
  Sound.cycle(); vibrate(4);
}
function softDrop() {
  if (!canAct()) return false;
  if (collides(piece.cells, piece.x, piece.y + 1)) return false;
  piece.y++; score += 1; dropTimer = 0; Sound.soft(); return true;
}
function hardDrop() {
  if (!canAct()) return;
  const d = ghostDist();
  piece.cells.forEach(([dx, dy], i) => {
    const c = piece.colors[i];
    trails.push({ x: piece.x + dx, y0: piece.ry + dy, y1: piece.y + d + dy, c, life: 1 });
  });
  piece.y += d; piece.ry = piece.y; piece.rx = piece.x;
  score += d * 2;
  shake = Math.max(shake, 5 + d * 0.3);
  Sound.hard(); vibrate(15);
  lock();
}
function tilt(dir) {
  if (!canAct() || meter < METER_MAX) return;
  meter = 0; meterWasFull = false; tiltMode = true; chain = 0;
  for (let r = 0; r < TOTAL; r++) {
    const row = grid[r].filter(Boolean), empty = Array(COLS - row.length).fill(null);
    grid[r] = dir < 0 ? row.concat(empty) : empty.concat(row);
  }
  forGems(g => { g.vx = 0; });
  tiltTarget = dir * 0.14;
  phase = 'tiltSlide'; phaseT = 0;
  shake = Math.max(shake, 8); flashAll = 0.5;
  addText(COLS / 2, HIDDEN + ROWS * 0.35, 'TILT!', '#ffffff', 1.5, 'prism');
  Sound.tilt(); vibrate([30, 40, 60]);
  updateHud();
}

function lock() {
  let over = false;
  piece.cells.forEach(([dx, dy], i) => {
    const x = piece.x + dx, y = piece.y + dy;
    if (y < 0) { over = true; return; }
    const g = newGem(piece.colors[i], x, y); g.flash = 0.7; g.pop = 0.6;
    grid[y][x] = g;
  });
  piece = null; piecesLocked++;
  Sound.lock(); vibrate(8);
  if (hintShown && piecesLocked >= 4) { $('hint').classList.remove('show'); hintShown = false; store.set('seenHint', true); }
  if (over) { gameOver(); return; }
  chain = 0; tiltMode = false;
  startSettle();
}

function startSettle() {
  for (let c = 0; c < COLS; c++) {
    let w = TOTAL - 1;
    for (let r = TOTAL - 1; r >= 0; r--) {
      const g = grid[r][c];
      if (g) { if (r !== w) { grid[w][c] = g; grid[r][c] = null; } w--; }
    }
  }
  phase = 'settle'; phaseT = 0;
}

function computeClears() {
  const keys = new Set();
  const ev = { match: 0, matchGems: new Set(), rows: [], prisms: [] };
  // prism detonations
  forGems((g, r, c) => {
    if (g.c !== PRISM) return;
    let target = -1;
    const below = r + 1 < TOTAL ? grid[r + 1][c] : null;
    if (below && below.c !== PRISM) target = below.c;
    else {
      const counts = {}; forGems(o => { if (o.c !== PRISM) counts[o.c] = (counts[o.c] || 0) + 1; });
      let bestN = 0; for (const k in counts) if (counts[k] > bestN) { bestN = counts[k]; target = +k; }
    }
    keys.add(r * COLS + c);
    const hits = [];
    if (target >= 0) forGems((o, rr, cc) => { if (o.c === target) { keys.add(rr * COLS + cc); hits.push([cc, rr]); } });
    ev.prisms.push({ c, r, target, hits });
  });
  // color runs
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let r = 0; r < TOTAL; r++) for (let c = 0; c < COLS; c++) {
    const g = grid[r][c]; if (!g || g.c === PRISM) continue;
    for (const [dx, dy] of dirs) {
      const pr = r - dy, pc = c - dx;
      if (pr >= 0 && pr < TOTAL && pc >= 0 && pc < COLS && grid[pr][pc] && grid[pr][pc].c === g.c) continue;
      let n = 1;
      while (true) {
        const nr = r + dy * n, nc = c + dx * n;
        if (nr < 0 || nr >= TOTAL || nc < 0 || nc >= COLS || !grid[nr][nc] || grid[nr][nc].c !== g.c) break;
        n++;
      }
      if (n >= 3) { ev.match++; for (let i = 0; i < n; i++) { const k = (r + dy * i) * COLS + (c + dx * i); keys.add(k); ev.matchGems.add(k); } }
    }
  }
  // full rows
  for (let r = 0; r < TOTAL; r++) {
    if (grid[r].every(Boolean)) { ev.rows.push(r); for (let c = 0; c < COLS; c++) keys.add(r * COLS + c); }
  }
  return { keys, ev };
}

function resolveCheck() {
  const { keys, ev } = computeClears();
  if (!keys.size) { finishResolution(); return; }
  chain++; maxChain = Math.max(maxChain, chain);
  clearing = { keys, ev };
  let sx = 0, sy = 0;
  keys.forEach(k => { const r = Math.floor(k / COLS), c = k % COLS; grid[r][c].clearing = true; sx += c; sy += r; });
  const cx = sx / keys.size, cy = sy / keys.size;

  // scoring
  const m = ev.matchGems.size;
  let pts = m * 10 + Math.max(0, m - 3) * 15;
  const nr = ev.rows.length;
  pts += [0, 150, 450, 1000, 1800][Math.min(nr, 4)] + Math.max(0, nr - 4) * 800;
  ev.prisms.forEach(p => pts += 100 + p.hits.length * 20);
  const mult = chain * level * (tiltMode ? 2 : 1);
  pts *= mult;
  score += pts;

  // feedback
  addText(cx, cy, '+' + pts.toLocaleString(), '#ffffff', 1);
  if (chain >= 2) addText(cx, cy - 1.1, `CHAIN ×${chain}`, chain >= 4 ? '#ff3d6e' : '#ffd24a', 1.1 + Math.min(chain, 6) * 0.08, chain >= 4 ? 'prism' : null);
  if (nr) {
    addText(COLS / 2, ev.rows[0] - 0.8, nr >= 4 ? 'PRISMATIC!' : ['ROW!', 'DOUBLE ROW!', 'TRIPLE ROW!'][nr - 1], '#ffffff', 1.25 + nr * 0.1, 'prism');
    ev.rows.forEach(r => beams.push({ r, life: 1 }));
    Sound.line(nr); flashAll = Math.max(flashAll, 0.25 + nr * 0.1);
  }
  if (ev.prisms.length) {
    ev.prisms.forEach(p => bolts.push({ ...p, life: 1 }));
    addText(COLS / 2, HIDDEN + ROWS * 0.4, 'PRISM BURST', '#ffffff', 1.3, 'prism');
    Sound.prism(); flashAll = Math.max(flashAll, 0.5);
  }
  if (tiltMode && chain === 1) addText(cx, cy + 1, '×2 TILT', '#38e8ff', 0.8);
  Sound.clear(chain, keys.size);
  shake = Math.max(shake, 2 + chain * 2.5 + nr * 3 + (ev.prisms.length ? 8 : 0));
  vibrate(chain > 1 ? [20, 30, 20 + chain * 10] : 18);
  phase = 'clear'; phaseT = 0;
}

function finishClear() {
  const { keys } = clearing;
  let n = 0;
  keys.forEach(k => {
    const r = Math.floor(k / COLS), c = k % COLS, g = grid[r][c];
    if (!g) return;
    burst(c, r, g.c, 10 + Math.min(chain * 2, 10));
    grid[r][c] = null; n++;
  });
  Sound.pop();
  gemsCleared += n; rowsCleared += clearing.ev.rows.length;
  if (!tiltMode) meter = Math.min(METER_MAX, meter + n);
  const newLevel = 1 + Math.floor(gemsCleared / 30);
  if (newLevel > level) {
    const oldColors = numColors();
    level = newLevel;
    addText(COLS / 2, HIDDEN + ROWS * 0.5, `LEVEL ${level}`, '#ffffff', 1.4, 'prism');
    if (numColors() > oldColors) addText(COLS / 2, HIDDEN + ROWS * 0.5 + 1.2, 'NEW GEM UNLOCKED', GEMS[numColors() - 1].hex, 0.75);
    Sound.level(); Sound.setTempo(92 + (level - 1) * 3);
    flashAll = Math.max(flashAll, 0.3);
  }
  if (meter >= METER_MAX && !meterWasFull) {
    meterWasFull = true; Sound.ready();
    addText(COLS / 2, HIDDEN + ROWS * 0.62, '◀ TILT READY ▶', '#38e8ff', 0.95);
  }
  clearing = null;
  updateHud();
  startSettle();
}

function finishResolution() {
  for (let r = 0; r < HIDDEN; r++) if (grid[r].some(Boolean)) { gameOver(); return; }
  tiltMode = false; tiltTarget = 0;
  if (piece) {
    let lift = 0;
    while (collides(piece.cells, piece.x, piece.y) && lift < 6) { piece.y--; lift++; }
    if (collides(piece.cells, piece.x, piece.y)) { gameOver(); return; }
    lockTimer = 0; phase = 'fall';
  } else { phase = 'spawn'; phaseT = 0; }
}

function gameOver() {
  if (phase === 'dying' || state === 'over') return;
  phase = 'dying'; phaseT = 0;
  if (piece) {
    piece.cells.forEach(([dx, dy], i) => {
      const x = piece.x + dx, y = Math.max(0, piece.y + dy);
      if (!grid[y][x]) grid[y][x] = newGem(piece.colors[i], x, y);
    });
    piece = null;
  }
  forGems(g => { g.vx = rand(-4, 4); g.vy = rand(-14, -4); g.vr = rand(-8, 8); });
  shake = 14; flashAll = 0.6;
  Sound.over(); Sound.stopMusic(); vibrate([60, 50, 120]);
}

function showGameOver() {
  state = 'over';
  body.classList.remove('playing', 'tilt-ready', 'danger'); $('hint').classList.remove('show');
  const isBest = score > best;
  if (isBest) { best = score; store.set('best', best); }
  store.set('games', store.get('games', 0) + 1);
  $('finalScore').textContent = score.toLocaleString();
  $('newBest').classList.toggle('show', isBest && score > 0);
  $('stLevel').textContent = level;
  $('stChain').textContent = maxChain ? '×' + maxChain : '—';
  $('stGems').textContent = gemsCleared;
  $('stRows').textContent = rowsCleared;
  $('bestOver').textContent = best.toLocaleString();
  $('bestMenu').textContent = best.toLocaleString();
  showScreen('over');
}

// ============================================================ effects
function toPx(c, r) { return [c * cell + cell / 2, (r - HIDDEN) * cell + cell / 2]; }
function burst(c, r, color, n) {
  const [x, y] = toPx(c, r);
  const hex = color === PRISM ? '#ffffff' : GEMS[color].hex;
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(2, 9) * cell;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - cell * 3, life: 1, decay: rand(1.1, 2), size: rand(0.25, 0.6) * cell, color, kind: 'dot' });
  }
  for (let i = 0; i < 4; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(3, 7) * cell;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - cell * 4, life: 1, decay: rand(0.8, 1.3), size: rand(0.18, 0.3) * cell, color, hex, kind: 'shard', rot: rand(0, 6), vr: rand(-12, 12) });
  }
  particles.push({ x, y, vx: 0, vy: 0, life: 1, decay: 2.8, size: cell * 0.5, color, hex, kind: 'ring' });
  if (particles.length > 700) particles.splice(0, particles.length - 700);
}
function addText(c, r, text, color, scale = 1, style = null) {
  const [x, y] = toPx(c - 0.5, r);
  texts.push({ x, y, text, color, scale, style, life: 1, age: 0 });
}
function sparkle() {
  const all = []; forGems((g, r) => { if (r >= HIDDEN && !g.clearing) all.push(g); });
  if (!all.length) return;
  const g = all[Math.floor(Math.random() * all.length)];
  const [x, y] = toPx(g.x, g.y);
  particles.push({ x: x + rand(-0.25, 0.1) * cell, y: y + rand(-0.3, 0) * cell, vx: 0, vy: 0, life: 1, decay: 1.6, size: cell * 0.35, color: g.c, kind: 'glint' });
}

// ============================================================ update
function update(dt) {
  time += dt;
  if (state === 'menu' || state === 'over') updateRain(dt);
  if (state !== 'play') { updateFx(dt); return; }
  phaseT += dt;

  switch (phase) {
    case 'fall': {
      dropTimer += dt;
      const iv = interval();
      while (dropTimer >= iv) { dropTimer -= iv; if (collides(piece.cells, piece.x, piece.y + 1)) { dropTimer = 0; break; } piece.y++; }
      if (grounded()) { lockTimer += dt; if (lockTimer >= LOCK_DELAY) { lock(); break; } }
      break;
    }
    case 'spawn': if (phaseT > 0.06) spawn(); break;
    case 'tiltSlide': {
      let moving = false;
      forGems((g, r, c) => {
        if (Math.abs(g.x - c) > 0.001) {
          const d = Math.sign(c - g.x);
          g.vx += d * 55 * dt; g.x += g.vx * dt;
          if ((d > 0 && g.x >= c) || (d < 0 && g.x <= c)) { g.x = c; g.vx = 0; g.pop = 0.5; Sound.land(); } else moving = true;
        } else { g.x = c; g.vx = 0; }
      });
      if (!moving && phaseT > 0.35) { tiltTarget = 0; startSettle(); }
      break;
    }
    case 'settle': {
      let moving = false;
      forGems((g, r, c) => {
        g.x = c;
        if (g.y < r - 0.001) {
          g.vy += 75 * dt; g.y += g.vy * dt;
          if (g.y >= r) { g.y = r; if (g.vy > 5) { g.pop = Math.min(1, g.vy / 18); Sound.land(); } g.vy = 0; } else moving = true;
        } else { g.y = r; g.vy = 0; }
      });
      if (!moving && Math.abs(tiltVis) < 0.02) resolveCheck();
      break;
    }
    case 'clear': if (phaseT >= CLEAR_TIME) finishClear(); break;
    case 'dying': {
      forGems(g => { g.vy += 40 * dt; g.x += g.vx * dt; g.y += g.vy * dt; g.rot += g.vr * dt; g.alpha = Math.max(0, 1 - phaseT / 1.6); });
      if (phaseT > 1.8) showGameOver();
      break;
    }
  }

  if (piece) {
    const k = 1 - Math.exp(-dt * 28);
    piece.rx += (piece.x - piece.rx) * k;
    piece.ry += (piece.y - piece.ry) * k;
    if (Math.abs(piece.rx - piece.x) < 0.002) piece.rx = piece.x;
    if (piece.cycleFx) piece.cycleFx = Math.max(0, piece.cycleFx - dt * 5);
  }
  forGems(g => { g.flash = Math.max(0, g.flash - dt * 3); g.pop = Math.max(0, g.pop - dt * 5); });

  // danger level: how high is the stack
  let top = TOTAL;
  for (let r = 0; r < TOTAL && top === TOTAL; r++) if (grid[r].some(Boolean)) top = r;
  const want = clamp((HIDDEN + 5 - top) / 5, 0, 1);
  dangerLvl += (want - dangerLvl) * Math.min(1, dt * 4);
  body.classList.toggle('danger', dangerLvl > 0.5);

  sparkleT -= dt;
  if (sparkleT <= 0) { sparkle(); sparkleT = rand(0.15, 0.4); }
  updateFx(dt);
  updateHud();
}
function updateFx(dt) {
  tiltVis += (tiltTarget - tiltVis) * Math.min(1, dt * (tiltTarget ? 9 : 6));
  shake = Math.max(0, shake - dt * 30);
  flashAll = Math.max(0, flashAll - dt * 1.8);
  const g = cell * 18;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= p.decay * dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    if (p.kind === 'dot' || p.kind === 'shard') { p.vy += g * dt; p.vx *= 1 - dt * 1.5; p.x += p.vx * dt; p.y += p.vy * dt; }
    if (p.rot !== undefined) p.rot += p.vr * dt;
  }
  for (let i = texts.length - 1; i >= 0; i--) { const t = texts[i]; t.age += dt; t.life -= dt * 0.75; t.y -= cell * 0.9 * dt; if (t.life <= 0) texts.splice(i, 1); }
  for (let i = beams.length - 1; i >= 0; i--) { beams[i].life -= dt * 2; if (beams[i].life <= 0) beams.splice(i, 1); }
  for (let i = bolts.length - 1; i >= 0; i--) { bolts[i].life -= dt * 2.2; if (bolts[i].life <= 0) bolts.splice(i, 1); }
  for (let i = trails.length - 1; i >= 0; i--) { trails[i].life -= dt * 4; if (trails[i].life <= 0) trails.splice(i, 1); }
}

// ============================================================ render
function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function drawGem(c, px, py, o = {}) {
  const spr = spriteFor(c, time + (o.phase || 0));
  const scale = o.scale || 1, sq = o.squash || 0;
  const s = cell * 1.5 * scale, w = s * (1 + sq * 0.16), h = s * (1 - sq * 0.16);
  const x = px - w / 2, y = py - h / 2 + (s - h) * 0.35;
  ctx.globalAlpha = o.alpha ?? 1;
  if (o.rot) { ctx.save(); ctx.translate(px, py); ctx.rotate(o.rot); ctx.drawImage(spr, -w / 2, -h / 2, w, h); ctx.restore(); }
  else ctx.drawImage(spr, x, y, w, h);
  if (o.flash > 0) {
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, o.flash) * (o.alpha ?? 1);
    ctx.drawImage(whiteFor(c), x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (state === 'menu' || state === 'over') drawRain();
  if (state === 'play' || state === 'paused') drawBoard();
}

function drawBoard() {
  const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
  ctx.save();
  ctx.translate(bx + bw / 2 + sx, by + bh / 2 + sy);
  ctx.rotate(tiltVis);
  ctx.translate(-bw / 2, -bh / 2);

  // frame glow + glass panel
  const pad = Math.max(6, cell * 0.18);
  ctx.save();
  ctx.shadowColor = dangerLvl > 0.05 ? `rgba(255,50,100,${0.3 + 0.5 * dangerLvl * (0.6 + 0.4 * Math.sin(time * 8))})` : 'rgba(140,100,255,.45)';
  ctx.shadowBlur = 30;
  roundRect(ctx, -pad, -pad, bw + pad * 2, bh + pad * 2, pad * 2);
  const panel = ctx.createLinearGradient(0, 0, 0, bh);
  panel.addColorStop(0, 'rgba(26,18,70,.78)'); panel.addColorStop(1, 'rgba(12,8,38,.86)');
  ctx.fillStyle = panel; ctx.fill();
  ctx.restore();
  // prismatic border
  const hue = (time * 30) % 360;
  const edge = ctx.createLinearGradient(0, 0, bw, bh);
  for (let i = 0; i <= 4; i++) edge.addColorStop(i / 4, `hsla(${(hue + i * 72) % 360},90%,70%,.55)`);
  ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
  roundRect(ctx, -pad, -pad, bw + pad * 2, bh + pad * 2, pad * 2); ctx.stroke();

  ctx.save();
  roundRect(ctx, 0, 0, bw, bh, pad); ctx.clip();
  // lanes
  for (let c = 0; c < COLS; c++) {
    if (c % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,.022)'; ctx.fillRect(c * cell, 0, cell, bh); }
  }
  ctx.fillStyle = 'rgba(200,180,255,.10)';
  for (let r = 1; r < ROWS; r++) for (let c = 1; c < COLS; c++) ctx.fillRect(c * cell - 1, r * cell - 1, 2, 2);
  // piece column highlight
  if (piece && phase === 'fall') {
    const minX = Math.min(...piece.cells.map(c => c[0])), maxX = Math.max(...piece.cells.map(c => c[0]));
    const lg = ctx.createLinearGradient(0, 0, 0, bh);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(255,255,255,.06)');
    ctx.fillStyle = lg; ctx.fillRect((piece.rx + minX) * cell, 0, (maxX - minX + 1) * cell, bh);
  }
  // danger haze
  if (dangerLvl > 0.02) {
    const dg = ctx.createLinearGradient(0, 0, 0, cell * 4);
    dg.addColorStop(0, `rgba(255,40,90,${0.35 * dangerLvl * (0.7 + 0.3 * Math.sin(time * 7))})`); dg.addColorStop(1, 'rgba(255,40,90,0)');
    ctx.fillStyle = dg; ctx.fillRect(0, 0, bw, cell * 4);
  }
  // trails
  ctx.globalCompositeOperation = 'lighter';
  for (const t of trails) {
    const hex = t.c === PRISM ? '#ffffff' : GEMS[t.c].hex;
    const x = t.x * cell + cell * 0.2, y0 = (t.y0 - HIDDEN) * cell, y1 = (t.y1 - HIDDEN) * cell + cell / 2;
    const tg = ctx.createLinearGradient(0, y0, 0, y1);
    tg.addColorStop(0, rgba(hex, 0)); tg.addColorStop(1, rgba(hex, 0.55 * t.life));
    ctx.fillStyle = tg; ctx.fillRect(x, y0, cell * 0.6, y1 - y0);
  }
  ctx.globalCompositeOperation = 'source-over';

  // ghost
  if (piece && phase === 'fall') {
    const d = ghostDist();
    if (d > 0) piece.cells.forEach(([dx, dy], i) => {
      const [x, y] = toPx(piece.x + dx, piece.y + d + dy);
      drawGem(piece.colors[i], x, y, { alpha: 0.2, scale: 0.92 });
    });
  }
  // board gems
  const clearP = phase === 'clear' ? phaseT / CLEAR_TIME : 0;
  forGems((g, r, c) => {
    const [x, y] = toPx(g.x, g.y);
    if (g.clearing) {
      const pulse = 0.5 + 0.5 * Math.sin(clearP * Math.PI * 5);
      drawGem(g.c, x, y, { scale: 1 + clearP * 0.3, flash: 0.35 + pulse * 0.65, alpha: 1 - Math.max(0, clearP - 0.75) * 3 });
    } else {
      drawGem(g.c, x, y, { squash: g.pop, flash: g.flash + flashAll * 0.4, alpha: g.alpha, rot: g.rot, phase: c * 0.07 + r * 0.05 });
    }
  });
  // active piece
  if (piece) {
    const alpha = phase === 'fall' ? 1 : 0.35;
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    piece.cells.forEach(([dx, dy], i) => {
      const [x, y] = toPx(piece.rx + dx, piece.ry + dy);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.16 + 0.1 * pulse) * alpha;
      const dsz = cell * 2.1, c = piece.colors[i];
      ctx.drawImage(dots[c], x - dsz / 2, y - dsz / 2, dsz, dsz);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      drawGem(c, x, y, { alpha, flash: (piece.cycleFx || 0) * 0.8, scale: 1 + (piece.cycleFx || 0) * 0.12 });
    });
  }
  // row beams
  ctx.globalCompositeOperation = 'lighter';
  for (const b of beams) {
    const y = (b.r - HIDDEN) * cell + cell / 2, h = cell * (0.3 + 1.6 * (1 - b.life)) * b.life + 2;
    const bg = ctx.createLinearGradient(0, y - h, 0, y + h);
    bg.addColorStop(0, 'rgba(120,200,255,0)'); bg.addColorStop(0.5, `rgba(255,255,255,${b.life})`); bg.addColorStop(1, 'rgba(255,120,220,0)');
    ctx.fillStyle = bg; ctx.fillRect(-cell, y - h, bw + cell * 2, h * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore(); // clip

  // prism bolts (unclipped)
  ctx.globalCompositeOperation = 'lighter';
  for (const b of bolts) {
    const [x0, y0] = toPx(b.c, b.r);
    b.hits.forEach(([hc, hr], i) => {
      const [x1, y1] = toPx(hc, hr);
      ctx.strokeStyle = `hsla(${(time * 400 + i * 40) % 360},100%,75%,${b.life})`;
      ctx.lineWidth = 1 + 2.5 * b.life;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      const segs = 6;
      for (let s = 1; s < segs; s++) {
        const t = s / segs;
        ctx.lineTo(x0 + (x1 - x0) * t + rand(-0.25, 0.25) * cell, y0 + (y1 - y0) * t + rand(-0.25, 0.25) * cell);
      }
      ctx.lineTo(x1, y1); ctx.stroke();
    });
  }
  // particles
  for (const p of particles) {
    const img = dots[p.color] || dots[0];
    if (p.kind === 'dot') {
      const s = p.size * (0.4 + p.life * 0.6);
      ctx.globalAlpha = Math.min(1, p.life * 1.4);
      ctx.drawImage(img, p.x - s, p.y - s, s * 2, s * 2);
    } else if (p.kind === 'shard') {
      ctx.globalAlpha = p.life;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.hex; const s = p.size;
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.5, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.5, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (p.kind === 'ring') {
      ctx.globalAlpha = p.life * 0.9;
      ctx.strokeStyle = p.hex; ctx.lineWidth = 3 * p.life;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size + (1 - p.life) * cell * 1.1, 0, Math.PI * 2); ctx.stroke();
    } else if (p.kind === 'glint') {
      const a = Math.sin(p.life * Math.PI), s = p.size * a;
      ctx.globalAlpha = a * 0.9; ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - s); ctx.quadraticCurveTo(p.x, p.y, p.x + s, p.y); ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s);
      ctx.quadraticCurveTo(p.x, p.y, p.x - s, p.y); ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s); ctx.fill();
    }
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

  // floating text
  for (const t of texts) {
    const pop = t.age < 0.18 ? 0.6 + (t.age / 0.18) * 0.55 : Math.max(1, 1.15 - (t.age - 0.18) * 1.2);
    let size = Math.max(14, cell * 0.62) * t.scale * pop;
    ctx.font = `900 ${size}px Unbounded, system-ui, sans-serif`;
    const fitW = ctx.measureText(t.text).width;
    if (fitW > bw * 0.94) { size *= bw * 0.94 / fitW; ctx.font = `900 ${size}px Unbounded, system-ui, sans-serif`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = clamp(t.life * 2, 0, 1);
    ctx.lineWidth = Math.max(3, size * 0.16); ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(10,4,30,.85)';
    const tx = clamp(t.x + cell / 2, ctx.measureText(t.text).width / 2 + 4, bw - ctx.measureText(t.text).width / 2 - 4);
    ctx.strokeText(t.text, tx, t.y);
    if (t.style === 'prism') {
      const w = ctx.measureText(t.text).width;
      const tg = ctx.createLinearGradient(tx - w / 2, 0, tx + w / 2, 0);
      for (let i = 0; i <= 5; i++) tg.addColorStop(i / 5, `hsl(${(time * 200 + i * 60) % 360},100%,72%)`);
      ctx.fillStyle = tg;
    } else ctx.fillStyle = t.color;
    ctx.shadowColor = t.color; ctx.shadowBlur = 12;
    ctx.fillText(t.text, tx, t.y);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (flashAll > 0.01) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(160,140,255,${flashAll * 0.18})`; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
}

// menu background: drifting gem rain
function updateRain(dt) {
  while (rain.length < 26) {
    rain.push({ x: rand(0, W), y: rain.length < 20 && !rain.inited ? rand(-H, H) : rand(-200, -40), c: Math.floor(rand(0, 6)), s: rand(0.5, 1.3), vy: rand(20, 60), rot: rand(0, 6), vr: rand(-0.6, 0.6), ph: rand(0, 6) });
  }
  rain.inited = true;
  for (let i = rain.length - 1; i >= 0; i--) {
    const d = rain[i]; d.y += d.vy * d.s * dt; d.rot += d.vr * dt; d.x += Math.sin(time * 0.8 + d.ph) * 8 * dt;
    if (d.y > H + 80) rain.splice(i, 1);
  }
}
function drawRain() {
  const base = Math.min(56, Math.max(30, W / 9));
  for (const d of rain) {
    const s = base * d.s * 1.5;
    ctx.globalAlpha = 0.18 + d.s * 0.3;
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
    ctx.drawImage(sprites[d.c], -s / 2, -s / 2, s, s); ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawNext() {
  if (!nextCv.width) return;
  const s = nextCv.width;
  nctx.clearRect(0, 0, s, s);
  if (!nextPiece || !sprites.length) return;
  const cs = s / 3.6;
  const xs = nextPiece.cells.map(c => c[0]), ys = nextPiece.cells.map(c => c[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  nextPiece.cells.forEach(([dx, dy], i) => {
    const c = nextPiece.colors[i];
    const spr = spriteFor(c, time);
    const x = s / 2 + (dx - cx) * cs, y = s / 2 + (dy - cy) * cs, w = cs * 1.5;
    nctx.drawImage(spr, x - w / 2, y - w / 2, w, w);
  });
}

// ============================================================ HUD
let hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud(force) {
  if (force) hudCache = {};
  shownScore += (score - shownScore) * 0.2;
  if (Math.abs(score - shownScore) < 1) shownScore = score;
  setText('score', Math.round(shownScore).toLocaleString());
  setText('level', String(level));
  const pct = Math.round(meter / METER_MAX * 100) + '%';
  if (hudCache.meter !== pct) { hudCache.meter = pct; $('meterFill').style.width = pct; }
  const ready = meter >= METER_MAX && state === 'play';
  if (hudCache.ready !== ready) { hudCache.ready = ready; body.classList.toggle('tilt-ready', ready); }
  if (nextPiece && nextPiece.kind === 'P') drawNext();
}

// ============================================================ screens
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === id));
  demosActive = id === 'howto';
}
let prevScreen = 'menu';
function pause() {
  if (state !== 'play' || phase === 'dying') return;
  state = 'paused'; showScreen('pause'); Sound.stopMusic(); Sound.suspend();
}
function resume() {
  if (state !== 'paused') return;
  state = 'play'; showScreen(null); Sound.resume(); if (settings.music) Sound.startMusic();
  last = performance.now();
}
function toMenu() {
  state = 'menu'; phase = 'idle'; piece = null; Sound.stopMusic(); Sound.resume();
  body.classList.remove('playing', 'tilt-ready', 'danger'); $('hint').classList.remove('show');
  $('bestMenu').textContent = best.toLocaleString();
  showScreen('menu');
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}
function refreshToggles() {
  document.querySelectorAll('[data-toggle]').forEach(b => {
    const on = settings[b.dataset.toggle];
    b.classList.toggle('off', !on); b.querySelector('b').textContent = on ? 'On' : 'Off';
  });
}

const tap = (id, fn) => $(id).addEventListener('click', e => { Sound.init(); Sound.click(); fn(e); });
tap('playBtn', newGame);
tap('againBtn', newGame);
tap('howBtn', () => { prevScreen = 'menu'; showScreen('howto'); });
tap('howBtn2', () => { prevScreen = 'pause'; showScreen('howto'); });
document.querySelector('[data-close="howto"]').addEventListener('click', () => { Sound.click(); showScreen(prevScreen); });
tap('pauseBtn', pause);
tap('resumeBtn', resume);
tap('restartBtn', newGame);
tap('quitBtn', toMenu);
tap('menuBtn', toMenu);
tap('shareBtn', async () => {
  const url = location.href.split('#')[0].split('?')[0];
  const text = `I scored ${score.toLocaleString()} in Prismfall 💎 (level ${level}, chain ×${maxChain}). Can you beat it?`;
  try {
    if (navigator.share) await navigator.share({ title: 'Prismfall', text, url });
    else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Copied to clipboard ✨'); }
  } catch {}
});
document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
  Sound.init();
  const k = b.dataset.toggle; settings[k] = !settings[k]; store.set(k, settings[k]);
  if (k === 'sfx') Sound.setSfx(settings.sfx);
  if (k === 'music') Sound.setMusic(settings.music);
  Sound.click(); refreshToggles();
}));
['tiltL', 'tiltR'].forEach((id, i) => {
  $(id).addEventListener('pointerdown', e => {
    e.preventDefault();
    if (meter < METER_MAX) { if (state === 'play') toast(`Clear ${METER_MAX - meter} more gems to charge TILT`); return; }
    tilt(i ? 1 : -1);
  });
});

// ============================================================ input: touch
let tp = null, lastGesture = null;
canvas.addEventListener('pointerdown', e => {
  Sound.init();
  if (state !== 'play') return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  const now = performance.now();
  tp = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, ax: 0, ay: 0, t0: now, moved: false, soft: 0, hist: [{ x: e.clientX, y: e.clientY, t: now }] };
});
canvas.addEventListener('pointermove', e => {
  if (!tp || e.pointerId !== tp.id) return;
  const now = performance.now();
  const step = Math.max(18, cell * 0.85);
  tp.ax += e.clientX - tp.lx; tp.ay += e.clientY - tp.ly;
  tp.lx = e.clientX; tp.ly = e.clientY;
  tp.hist.push({ x: e.clientX, y: e.clientY, t: now });
  while (tp.hist.length > 2 && now - tp.hist[0].t > 110) tp.hist.shift();
  const totDx = e.clientX - tp.x0, totDy = e.clientY - tp.y0;
  // horizontal follow
  while (tp.ax >= step) { tp.ax -= step; move(1); tp.moved = true; }
  while (tp.ax <= -step) { tp.ax += step; move(-1); tp.moved = true; }
  // slow downward drag = soft drop (only when mostly vertical)
  if (totDy > step * 0.8 && Math.abs(totDy) > Math.abs(totDx) * 1.2) {
    while (tp.ay >= step) { tp.ay -= step; if (softDrop()) tp.soft++; tp.moved = true; }
  } else if (tp.ay > 0) tp.ay = Math.min(tp.ay, step * 0.5);
  if (tp.ay < -step) tp.ay = -step;
});
function endTouch(e) {
  if (!tp || e.pointerId !== tp.id) return;
  const now = performance.now();
  const dt = now - tp.t0;
  const dx = e.clientX - tp.x0, dy = e.clientY - tp.y0;
  const h0 = tp.hist[0];
  const vy = (e.clientY - h0.y) / Math.max(16, now - h0.t);
  const vx = (e.clientX - h0.x) / Math.max(16, now - h0.t);
  lastGesture = { vy, vx, dx, dy, dt, moved: tp.moved, type: e.type };
  if (e.type === 'pointerup') {
    if (!tp.moved && Math.hypot(dx, dy) < 14 && dt < 350) rotate(1);
    else if (vy > 0.9 && dy > 30 && Math.abs(vy) > Math.abs(vx) * 1.4) hardDrop();
    else if (vy < -0.55 && dy < -28 && Math.abs(dy) > Math.abs(dx) * 1.3) cycleColors();
  }
  tp = null;
}
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

// ============================================================ input: keyboard
addEventListener('keydown', e => {
  Sound.init();
  if (state === 'play') {
    const k = e.code;
    const map = {
      ArrowLeft: () => move(-1), KeyA: () => move(-1),
      ArrowRight: () => move(1), KeyD: () => move(1),
      ArrowDown: () => softDrop(), KeyS: () => softDrop(),
      ArrowUp: () => rotate(1), KeyX: () => rotate(1), KeyW: () => rotate(1), KeyZ: () => rotate(-1),
      Space: () => hardDrop(),
      KeyC: () => cycleColors(), ShiftLeft: () => cycleColors(), ShiftRight: () => cycleColors(),
      KeyQ: () => tilt(-1), KeyE: () => tilt(1),
      Escape: () => pause(), KeyP: () => pause(),
    };
    if (map[k]) { e.preventDefault(); if (e.repeat && (k === 'Space' || k.startsWith('Shift') || k === 'KeyC' || k === 'KeyQ' || k === 'KeyE')) return; map[k](); }
  } else if (state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) resume();
  else if ((state === 'menu' || state === 'over') && (e.code === 'Enter' || e.code === 'Space') && !$('howto').classList.contains('show')) { e.preventDefault(); newGame(); }
});

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('blur', () => { if (state === 'play' && phase !== 'dying') pause(); });
addEventListener('resize', resize);
if (window.visualViewport) visualViewport.addEventListener('resize', resize);

// ============================================================ how-to demos
let demosActive = false, demoCanvases = [];
function buildDemos() {
  demoCanvases = [];
  document.querySelectorAll('.demo').forEach(el => {
    let cv = el.querySelector('canvas');
    if (!cv) { cv = document.createElement('canvas'); el.appendChild(cv); }
    cv.width = 76 * DPR; cv.height = 56 * DPR;
    demoCanvases.push({ cv, c: cv.getContext('2d'), kind: el.dataset.demo });
  });
  // logo gems
  const lg = $('logoGems');
  if (lg && !lg.childElementCount && sprites.length) {
    [0, 1, 2, 3, 4, 5].forEach((c, i) => {
      const img = new Image(); img.src = sprites[c].toDataURL(); img.alt = '';
      img.style.animationDelay = (i * 0.18) + 's'; lg.appendChild(img);
    });
  }
}
function drawDemos() {
  const t = time;
  for (const d of demoCanvases) {
    const c = d.c, w = d.cv.width, h = d.cv.height, u = h / 3.4;
    c.clearRect(0, 0, w, h);
    const g = (col, x, y, a = 1, sc = 1) => {
      const spr = spriteFor(col, t), s = u * 1.5 * sc;
      c.globalAlpha = a; c.drawImage(spr, x - s / 2, y - s / 2, s, s); c.globalAlpha = 1;
    };
    const cx = w / 2, cy = h / 2;
    switch (d.kind) {
      case 'move': {
        const off = Math.sin(t * 2) * u * 1.2;
        [0, 3, 1].forEach((col, i) => g(col, cx + off, cy + (i - 1) * u));
        c.fillStyle = 'rgba(255,255,255,.5)'; c.font = `${u * 0.8}px sans-serif`; c.textAlign = 'center';
        c.fillText('↔', cx, h - 2);
        break;
      }
      case 'cycle': {
        const k = Math.floor(t * 1.2) % 3, cols = [2, 4, 1];
        [0, 1, 2].forEach(i => g(cols[(i + 3 - k) % 3], cx, cy + (i - 1) * u, 1, 1 + (t * 1.2 % 1 < 0.15 ? 0.1 : 0)));
        break;
      }
      case 'match': {
        const p = (t % 2) / 2;
        const flash = p > 0.6 ? 0.5 + 0.5 * Math.sin(p * 40) : 0;
        [-1, 0, 1].forEach(i => g(0, cx + i * u, cy + u * 0.5, p > 0.9 ? 0 : 1, 1 + flash * 0.15));
        g(3, cx - u, cy - u * 0.5, 0.6); g(1, cx + u, cy - u * 0.5, 0.6);
        break;
      }
      case 'tilt': {
        c.save(); c.translate(cx, cy); c.rotate(Math.sin(t * 1.6) * 0.18);
        c.strokeStyle = 'rgba(200,180,255,.35)'; c.strokeRect(-u * 2, -u * 1.5, u * 4, u * 3);
        const s = Math.sin(t * 1.6);
        [[3, 0], [1, 1], [5, 2]].forEach(([col, i]) => g(col, -u * 1.5 + i * u + (s > 0 ? u * 0.9 * s : 0), u * 0.9));
        [[2, 0], [4, 1]].forEach(([col, i]) => g(col, -u * 1.5 + i * u + (s > 0 ? u * 1.9 * s : 0), -u * 0.1));
        c.restore();
        break;
      }
      case 'prism': {
        const p = (t % 2.4) / 2.4;
        const py = Math.min(cy, -u + p * 3 * cy);
        g(PRISM, cx, py - u * 0.2, 1);
        [-1.2, 0, 1.2].forEach(i => g(0, cx + i * u, cy + u, p > 0.7 ? 1 - (p - 0.7) * 3.3 : 1));
        break;
      }
    }
  }
}

// ============================================================ loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt);
  render();
  if (demosActive) drawDemos();
  if (nextPiece && nextPiece.kind === 'P' && state === 'play') drawNext();
  requestAnimationFrame(frame);
}

// ============================================================ boot
refreshToggles();
$('bestMenu').textContent = best.toLocaleString();
resize();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
requestAnimationFrame(t => { last = t; frame(t); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// test hooks
window.__prism = {
  get gesture() { return lastGesture; },
  get state() { return { state, phase, score, level, meter, chain, maxChain, gemsCleared, rowsCleared, piece, grid }; },
  newGame, move, rotate, hardDrop, softDrop, cycleColors, tilt,
  fillMeter() { meter = METER_MAX; updateHud(); },
  setGrid(rows) { grid = makeGrid(); rows.forEach((row, i) => { const r = TOTAL - rows.length + i; [...row].forEach((ch, c) => { if (ch !== '.') grid[r][c] = newGem(ch === '*' ? PRISM : +ch, c, r); }); }); },
  setPiece(kind, colors) { if (piece) { piece.kind = kind; piece.cells = SHAPES[kind].map(p => p.slice()); piece.colors = colors; } },
};
})();
