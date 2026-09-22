/* King of Atlantis — v4 daily loop: state machine, scenes, HUD. */
'use strict';

/* ------------------------------------------------------------------ scene layouts (plate pixel coords) */
// Room plate 1672x941 (01 day / 02 night share the same camera). Adjust here if an authoritative plate differs.
const ROOM = {
  w: 1672, h: 941,
  outline: [[0, 330], [470, 18], [1340, 18], [1450, 110], [1672, 230], [1672, 700], [1580, 900], [320, 900], [120, 860], [0, 760]],
  floor: [[770, 420], [1100, 330], [1160, 480], [1330, 610], [1310, 770], [1000, 870], [640, 870], [500, 770], [560, 690], [700, 620], [760, 560]],
  sleep: [345, 318], stand: [820, 540], door: [575, 745], desk: [1130, 560], sit: [655, 612], bedZone: [720, 560],
  blanket: [[311, 395], [481, 307], [770, 440], [750, 485], [515, 575], [345, 485]],
  nightstand: [205, 452], battle: [880, 560], closeCam: [470, 410],
};
// Backyard plate 1672x941 (03). Stand-in painted to this layout.
const YARD = { // 03-state-housing-backyard.png (Asset Pack v1): Ben's ground-floor door right, exit path bottom-left
  w: 1672, h: 941,
  walk: [[200, 40], [330, 40], [420, 280], [600, 330], [700, 260], [820, 320], [1000, 385], [1100, 472], [1262, 472], [1300, 452],
    [1500, 560], [1450, 600], [1300, 625], [1200, 700], [1000, 760], [880, 735], [720, 735], [600, 705], [485, 725], [470, 935],
    [300, 935], [300, 770], [330, 640], [445, 605], [425, 500], [330, 470], [290, 330]],
  block: [[240, 520, 455, 650], [1060, 540, 1165, 610]],
  door: [1345, 478], gate: [385, 905], hutch: [430, 770], burrow: [300, 700],
  nodes: [[385, 900], [400, 780], [540, 660], [560, 560], [700, 560], [900, 600], [1100, 540], [1320, 500], [1345, 478], [480, 400], [360, 250], [260, 80], [800, 420]],
  walkInDoor: [-0.35, 1], walkInGate: [0.15, -1],
};
// Photoreal Kapaʻa maps (True-Photoreal Maps v2), each 3072x1536 = 6x3 cells of 512. Walkable area is hand-authored
// road/sidewalk/lot rectangles measured from the plates (never derived from photo colour at runtime); rasterised to an
// 8 px grid at load for path-finding. Ped + car lanes are generated from the same road list.
//   roads: [x0, y0, w, h] rectangles of asphalt; sidewalk margin is added around each.
function townMap(key, def) {
  const M = Object.assign({ key, w: 3072, h: 1536, sidewalk: 40, walk: [], block: [], pedLanes: [], carLanes: [], lanePair: [] }, def);
  M.walk = M.roads.map(r => [r[0] - M.sidewalk, r[1] - M.sidewalk, r[2] + 2 * M.sidewalk, r[3] + 2 * M.sidewalk]).concat(M.extra || []);
  for (const r of M.roads) { // lanes: a sidewalk on each side (paired), two car lanes
    const horiz = r[2] > r[3], i = M.pedLanes.length;
    if (horiz) { const y0 = r[1] - 14, y1 = r[1] + r[3] + 14, cy = r[1] + r[3] / 2;
      M.pedLanes.push({ a: [r[0], y0], b: [r[0] + r[2], y0] }, { a: [r[0], y1], b: [r[0] + r[2], y1] });
      M.carLanes.push({ a: [r[0] - 150, cy + r[3] * 0.22], b: [r[0] + r[2] + 150, cy + r[3] * 0.22] }, { a: [r[0] + r[2] + 150, cy - r[3] * 0.22], b: [r[0] - 150, cy - r[3] * 0.22] }); }
    else { const x0 = r[0] - 14, x1 = r[0] + r[2] + 14, cx = r[0] + r[2] / 2;
      M.pedLanes.push({ a: [x0, r[1]], b: [x0, r[1] + r[3]] }, { a: [x1, r[1]], b: [x1, r[1] + r[3]] });
      M.carLanes.push({ a: [cx + r[2] * 0.22, r[1] - 150], b: [cx + r[2] * 0.22, r[1] + r[3] + 150] }, { a: [cx - r[2] * 0.22, r[1] + r[3] + 150], b: [cx - r[2] * 0.22, r[1] - 150] }); }
    M.lanePair.push(i + 1, i);
  }
  if (M.carLaneFilter) M.carLanes = M.carLanes.filter(M.carLaneFilter);
  return M;
}
function rasterize(M, cell = 8) { // walk/block rects -> grid (deterministic, identical for any plate variant)
  const w = Math.ceil(M.w / cell), h = Math.ceil(M.h / cell), g = new Uint8Array(w * h);
  const inR = (r, x, y) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) { const x = (cx + 0.5) * cell, y = (cy + 0.5) * cell;
    g[cy * w + cx] = M.walk.some(r => inR(r, x, y)) && !M.block.some(r => inR(r, x, y)) && x > 4 && y > 4 && x < M.w - 4 && y < M.h - 4 ? 1 : 0; }
  M.grid = { cell, w, h, g }; return M;
}
// Safeway district: two avenues (y 258-349, 1094-1197), two through streets (x 393-503, 2518-2622), a short street north
// and south of the store block, the lot (with two planted islands) and the storefront walkway under the canopy.
const STREET = rasterize(townMap('safeway', {
  roads: [[0, 258, 3072, 91], [0, 1094, 3072, 103], [393, 0, 110, 1536], [2518, 0, 104, 1536], [1518, 0, 71, 258], [1480, 1197, 130, 339],
    [1010, 349, 45, 745], [1889, 349, 83, 745]],
  extra: [[1080, 700, 830, 400], [1080, 640, 830, 70]],
  block: [[1090, 860, 210, 140], [1430, 860, 430, 140]],
  home: [1545, 1530], homeSpawn: [1545, 1470], safeway: [1430, 690], safewaySpawn: [1430, 770],
  carLaneFilter: l => Math.abs(l.a[0] - l.b[0]) > 2000 || Math.abs(l.a[1] - l.b[1]) > 1400,
}));
// Residential grid: enter from the coastal map on the lower avenue (west edge), leave north up the first through street.
const TOWN = rasterize(townMap('residential', {
  roads: [[960, 255, 2112, 84], [960, 963, 2112, 90], [987, 0, 124, 1536], [2335, 0, 120, 1536], [2791, 0, 69, 1536]],
  southIn: [1049, 1530], southSpawn: [1049, 1470], northOut: [1049, 20], northSpawn: [1049, 60],
  carLaneFilter: l => Math.abs(l.a[0] - l.b[0]) > 2000 || (Math.abs(l.a[1] - l.b[1]) > 1400 && Math.abs(l.a[0] - 2825) > 60),
}));
// Coastal: sand + the coastal footpath on the west, avenues at y 259-327 / 943-1022, through streets x 1077-1161 / 2347-2465.
// Ben arrives from home at the south end of the footpath and leaves east along the lower avenue toward the residential grid.
const COAST = rasterize(townMap('coastal', {
  roads: [[1080, 259, 1992, 68], [1080, 943, 1992, 79], [1077, 0, 84, 1536], [2347, 0, 118, 1536]],
  extra: [[730, 0, 110, 1536], [466, 0, 150, 1536], [560, 280, 220, 50], [560, 1180, 220, 50], [745, 220, 380, 150], [745, 905, 380, 155]],
  pedExtra: [{ a: [782, 0], b: [782, 1536] }],
  south: [782, 1530], southSpawn: [782, 1470], northOut: [1119, 20], northSpawn: [1119, 60], barrierY: 240, waveTrigger: 640,
  foeSpots: [[1060, 80], [1190, 150], [1110, 200], [1230, 60]],
  carLaneFilter: l => Math.abs(l.a[0] - l.b[0]) > 1800 || Math.abs(l.a[1] - l.b[1]) > 1400,
}));
COAST.pedLanes.push(...COAST.pedExtra); COAST.lanePair.push(COAST.pedLanes.length - 1);
function mapCanStand(M, x, y) {
  if (x < 4 || y < 4 || x > M.w - 4 || y > M.h - 4) return false;
  if (M.grid) { const G = M.grid; return G.g[Math.floor(y / G.cell) * G.w + Math.floor(x / G.cell)] === 1; }
  return M.walk.some(r => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]) &&
    !M.block.some(r => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]);
}
// shortest route over a mask grid (8-neighbour BFS), then pulled tight with line-of-sight
function gridPath(M, fx, fy, tx, ty, clear) {
  const G = M.grid, C = G.cell, w = G.w, h = G.h, g = G.g;
  const ci = (x, y) => clamp(Math.floor(y / C), 0, h - 1) * w + clamp(Math.floor(x / C), 0, w - 1);
  const s = ci(fx, fy); let t = ci(tx, ty);
  if (!g[t]) { let best = -1, bd = 1e9; const cx = t % w, cy = (t / w) | 0;
    for (let dy = -40; dy <= 40; dy++) for (let dx = -40; dx <= 40; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= w || y >= h || !g[y * w + x]) continue; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = y * w + x; } }
    if (best < 0) return [[fx, fy]]; t = best; }
  const prev = new Int32Array(w * h).fill(-1), q = new Int32Array(w * h); let qh = 0, qt = 0; q[qt++] = s; prev[s] = s;
  while (qh < qt) { const u = q[qh++]; if (u === t) break; const ux = u % w, uy = (u / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const x = ux + dx, y = uy + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue; const v = y * w + x; if (prev[v] >= 0 || !g[v]) continue; prev[v] = u; q[qt++] = v; } }
  if (prev[t] < 0) return [[tx, ty]];
  const cells = []; for (let v = t; v !== s; v = prev[v]) cells.unshift([(v % w + 0.5) * C, (((v / w) | 0) + 0.5) * C]);
  const end = g[ci(tx, ty)] ? [tx, ty] : cells[cells.length - 1]; cells.push(end);
  const out = []; let from = [fx, fy], i = 0;
  while (i < cells.length) { let j = cells.length - 1; while (j > i && !clear(from, cells[j])) j--; out.push(cells[j]); from = cells[j]; i = j + 1; }
  return out;
}

/* ------------------------------------------------------------------ state machine definition */
const LOOP = ['NIGHT_CLOSE', 'ASTRAL_REVEAL', 'LESSER_ENTITIES', 'DEMON_BATTLE', 'DAWN', 'ROOM_MORNING', 'BACKYARD_MORNING',
  'BEACH_OUTBOUND', 'TOWN_OUTBOUND', 'STREET_OUTBOUND', 'SAFEWAY', 'STREET_RETURN', 'TOWN_RETURN', 'BEACH_RETURN', 'BACKYARD_EVENING', 'ROOM_EATING', 'BED'];
const NEXT = {}; LOOP.forEach((s, i) => NEXT[s] = LOOP[(i + 1) % LOOP.length]);
NEXT.DREAM = 'ACT_END'; // after the final night's demon: DEMON_BATTLE -> DREAM -> ACT_END (outside the daily loop)
const COMPLETE_WHEN = {
  NIGHT_CLOSE: 'close hold on sleeping Ben finishes (3 s)',
  ASTRAL_REVEAL: '5 sound events + zoom-out done, island composition held, Ben on his feet',
  LESSER_ENTITIES: `${CFG.lesserEncounters} lesser encounters resolved one at a time`,
  DEMON_BATTLE: 'demon takes 5 hits, dissolves, MADE IT THROUGH ANOTHER NIGHT held',
  DAWN: 'night→day crossfade resolves with Ben asleep',
  ROOM_MORNING: 'player gets up, walks to door, interacts',
  BACKYARD_MORNING: 'guinea pig fed, Ben walks out the gate (from day 2: only with "Bring Guinea Pig friend")',
  BEACH_OUTBOUND: 'barrier wave of 4 cleared, Ben leaves the coastal map east along the lower avenue',
  TOWN_OUTBOUND: 'Ben crosses the residential grid and leaves north',
  STREET_OUTBOUND: 'Ben reaches the Safeway entrance trigger',
  SAFEWAY: 'purchase applied, Ben respawned outside with bag',
  STREET_RETURN: 'Ben leaves the Safeway district by the south street',
  TOWN_RETURN: 'Ben crosses the residential grid back to the west edge',
  BEACH_RETURN: 'Ben reaches the south end of the coastal path (home)',
  BACKYARD_EVENING: 'guinea pig fed again, Ben enters the building',
  ROOM_EATING: 'groceries put away, ice cream eaten, tub set aside',
  BED: 'player interacts with bed ("The nights are the hardest."); day 1 -> night fight, day 2 -> DREAM',
  DREAM: 'night 2 (no fight): the guinea pig offers a spirit journey (9 s)',
  ACT_END: 'end card: It wasn\'t always like this… / ACT 2: KALALAU / TO BE CONTINUED; tap returns to title',
};
const MODE_OF = {
  NIGHT_CLOSE: 'room', ASTRAL_REVEAL: 'room', LESSER_ENTITIES: 'room', DEMON_BATTLE: 'room', DAWN: 'room', ROOM_MORNING: 'room',
  BACKYARD_MORNING: 'yard', BEACH_OUTBOUND: 'street', TOWN_OUTBOUND: 'street', STREET_OUTBOUND: 'street', SAFEWAY: 'street', STREET_RETURN: 'street', TOWN_RETURN: 'street', BEACH_RETURN: 'street',
  BACKYARD_EVENING: 'yard', ROOM_EATING: 'room', BED: 'room', DREAM: 'room', ACT_END: 'end',
};

/* ------------------------------------------------------------------ game */
const Game = {
  canvas: null, ctx: null, W: 0, H: 0, dpr: 1,
  state: null, stateT: 0, sub: {}, trans: null, snapshot: null, snapT: 0,
  paused: false, started: false, gameOver: null, debug: false, seed: 1234, rng: Math.random, time: 0,
  stats: null, inv: null, day: 1, objective: '', toast: null, center: null, lastSave: '—', lastSfx: '', history: [],
  cam: { x: 0, y: 0, z: 1 }, mode: 'room', map: STREET, pigF: null,
  ben: { x: 0, y: 0, dir: 4, phase: 0, moving: false, pose: 'idle', asleep: true, h: 235, alpha: 1 },
  room: { plate: 'night', mix: 0, void: 0, outer: [0, 0, 0], evening: 0 },

  init() {
    const q = new URLSearchParams(location.search);
    this.debug = q.has('debug');
    if (q.has('seed')) this.seed = parseInt(q.get('seed'), 10) || 1234;
    else if (!this.debug) this.seed = (Math.random() * 1e9) | 0;
    this.canvas = document.getElementById('game'); this.ctx = this.canvas.getContext('2d');
    this.layer = document.createElement('canvas'); this.layer.width = ROOM.w; this.layer.height = ROOM.h; this.lctx = this.layer.getContext('2d');
    this.mask = document.createElement('canvas'); this.mask.width = ROOM.w / 4; this.mask.height = ROOM.h / 4; this.mctx = this.mask.getContext('2d');
    this.snapCanvas = document.createElement('canvas');
    this.mask2 = document.createElement('canvas'); this.mask2.width = ROOM.w / 16; this.mask2.height = Math.round(ROOM.h / 16);
    Input.init(this.canvas);
    window.addEventListener('resize', () => this.resize()); this.resize();
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    window.addEventListener('blur', () => this.pause());
    this.waves = new Pool(() => ({}), 8); this.fx = new Pool(() => ({}), 48); this.parts = new Pool(() => ({}), 120);
    this.pulses = new Pool(() => ({}), 6); this.peds = new Pool(() => ({}), 16); this.cars = new Pool(() => ({}), 8);
    this.splash = new Image(); this.splash.src = 'runtime/ui/splash.jpg';
    Assets.load(() => { this.ready = true; });
    let last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      try { this.frame(dt); }
      catch (err) { // never freeze: log it, show it small in the corner, keep running
        this.errors = (this.errors || 0) + 1; this.lastError = `${this.state || 'title'}: ${err && err.message}`; console.error(err);
        try { Input.endFrame(); const c = this.ctx; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, this.H - 22, this.W, 22); c.fillStyle = '#ff9a8a'; c.font = '12px system-ui'; c.textAlign = 'left'; c.fillText('Glitch (game kept running) — ' + this.lastError, 8, this.H - 7); } catch (e2) { }
      }
      try { Music.set(this.musicCue()); Music.update(dt); } catch (e3) { }
    };
    requestAnimationFrame(loop);
  },
  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const host = document.body; this.W = (host && host.clientWidth) || window.innerWidth; this.H = (host && host.clientHeight) || window.innerHeight;
    this.canvas.width = this.W * this.dpr; this.canvas.height = this.H * this.dpr;
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
  },
  pause() { if (this.started && !this.paused && !this.gameOver) { this.paused = true; Audio.suspend(); Music.pauseAll(); Input.keys.clear(); } },
  // which music should be playing right now (null = none / ambience only)
  musicCue() {
    if (!this.started || !this.state || this.paused || this.gameOver) return null;
    const st = this.state, s = this.sub || {};
    if (st === 'LESSER_ENTITIES' || st === 'DEMON_BATTLE') return 'battle-night';
    if (st === 'KALALAU' && typeof Kal !== 'undefined') {
      if (Kal.kama && Kal.kama.mode !== 'mist') return 'battle-night';
      if (Kal.marchers && Kal.marchers.map === Kal.mapId && Kal.marchers.warned) return 'battle-night';
      if (Kal.phase === 'FIGHT' || Kal.phase === 'HELICOPTER_RESPONSE' || (Kal.chase && !Kal.hidden) || Kal.camp.state === 'burning') return 'battle-day';
      return null;
    }
    if (this.mode === 'street') { // daytime battle: the shade barrier, or people charging at Ben (holds 5 s after the last one)
      if (s.foes && s.foesLeft > 0 && s.barrierY) this.lastFight = this.time;
      let seeking = false; this.peds.each(p => { if (p.seek > 0 && p.energetic) seeking = true; }); if (seeking) this.lastFight = this.time;
      if (this.time - (this.lastFight || -99) < 4) return 'battle-day';
    }
    // otherwise Act 1 sits on the house music (Mountain Dreamers) — the drums fade up for a fight and back down to this after
    if (this.mode === 'street' || this.mode === 'yard') return 'town'; // the house music cue, if it's armed and not used up
    return null;
  },
  onAnyInput() {
    Audio.init();
    if (this.paused) { this.paused = false; Audio.resume(); Input.pressed.clear(); Input.pointer.tapQueue.length = 0; }
  },
  dayK() { return Math.pow(CFG.daySpeedUp, Math.max(0, this.day - 1)); }, // street/coast pace: day 1 ×1, day 2 ×1.5
  nightK() { return Math.pow(CFG.daySpeedUp, Math.max(0, this.day - 2)); }, // the night after day 1 is the first fight (×1); any later ones speed up
  wantsStick() { return this.state && !['LESSER_ENTITIES', 'DEMON_BATTLE'].includes(this.state); },
  rngFor(tag) { let h = this.seed ^ 0x9e3779b9; for (const c of tag + this.day) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return mulberry32(h); },

  /* ---------------- new game / save / load ---------------- */
  newGame() {
    this.stats = { health: 100, astral: 100, overload: 0, money: CFG.startMoney, hunger: 35, fatigue: 60 };
    this.inv = { carrots: CFG.startCarrots, groceries: false, carryingBag: false, groceriesStored: false, pigCharges: 0 };
    this.day = 1; this.go('ROOM_MORNING', { fade: 0.8 });
  },
  snapshotSave(state) { return { v: 4, state, day: this.day, seed: this.seed, stats: { ...this.stats }, inv: { ...this.inv } }; },
  loadSave(s) { this.stats = { ...s.stats }; this.inv = { ...s.inv }; this.day = s.day; if (s.state === 'KALALAU' && s.kal) { Kal.restore(s.kal); } this.go(s.state, { fade: 0.8 }); },
  startKalalau() { this.stats = this.stats || { health: 100, astral: 100, overload: 0, money: 0, hunger: 30, fatigue: 30 }; this.inv = this.inv || { carrots: 0 }; Kal.map = null; this.go('KALALAU', { fade: 1.0 }); },
  imgOf(k) { return Assets.img[k]; },

  /* ---------------- transitions ---------------- */
  go(next, { fade = 0.5, style = 'black' } = {}) {
    if (this.trans) return;
    if (style === 'cross' || fade === 0) { this.switchState(next, style === 'cross' ? fade : 0); return; }
    this.trans = { phase: 'out', t: 0, dur: fade, next };
  },
  switchState(next, crossDur = 0) {
    if (crossDur > 0) { // snapshot current frame for a true crossfade
      this.snapCanvas.width = this.canvas.width; this.snapCanvas.height = this.canvas.height;
      this.snapCanvas.getContext('2d').drawImage(this.canvas, 0, 0); this.snapshot = { t: 0, dur: crossDur };
    }
    const prev = this.state;
    if (prev && S[prev].exit) S[prev].exit.call(this);
    this.state = next; this.stateT = 0; this.sub = {}; this.mode = MODE_OF[next]; this.walkTarget = null; this.actOnArrive = false;
    this.history.push(next); if (this.history.length > 40) this.history.shift();
    S[next].enter.call(this);
    if (!this.trans && !this.snapshot) this.stable();
  },
  stable() { // called only once a state is fully on screen (never mid-transition)
    if (this.state === 'KALALAU' && !this.sub.saved) { this.sub.saved = true; Kal.save(); }
    if ((this.state === 'ROOM_MORNING' || this.state === 'NIGHT_CLOSE') && !this.sub.saved) {
      this.sub.saved = true; Save.write(this.snapshotSave(this.state));
    }
  },
  complete() {
    this.go(NEXT[this.state], S[this.state].exitFade || { fade: 0.5 });
  },
  // Ben's own voice: a small subtitle in the lower third + the browser voice (lower, slower than the street callouts)
  benLine(text, delay = 0, dur = 5, big = false) { this.line = { text, t: -delay, dur, spoken: false, big }; },

  /* ---------------- per-frame ---------------- */
  frame(dt) {
    const ctx = this.ctx;
    const host = document.body, hw = (host && host.clientWidth) || window.innerWidth, hh = (host && host.clientHeight) || window.innerHeight;
    if (hw !== this.W || hh !== this.H) this.resize();
    if (!this.started || !this.ready) { this.drawTitle(dt); Input.endFrame(); return; }
    if (!this.paused && !this.gameOver) {
      this.time += dt;
      if (this.trans) {
        this.trans.t += dt;
        if (this.trans.phase === 'out' && this.trans.t >= this.trans.dur) { const n = this.trans.next; this.trans.phase = 'in'; this.trans.t = 0; this.switchState(n); }
        else if (this.trans.phase === 'in' && this.trans.t >= this.trans.dur) { this.trans = null; this.stable(); }
      }
      if (this.snapshot) { this.snapshot.t += dt; if (this.snapshot.t >= this.snapshot.dur) { this.snapshot = null; this.stable(); } }
      if (!this.trans) this.handleTaps();
      if (!this.trans || this.trans.phase === 'in') { this.stateT += dt; S[this.state].update.call(this, dt, !this.trans); }
      this.updateCommon(dt);
    } else if (this.gameOver) {
      this.gameOver.t += dt;
      if (this.gameOver.t > 1.2 && (Input.action() || Input.fire())) this.retry();
    }
    this.draw();
    Input.endFrame();
  },
  updateCommon(dt) {
    this.fx.each(f => { f.t += dt; f.x += (f.vx || 0) * dt; f.y += (f.vy || 0) * dt; if (f.t >= f.dur) f.alive = false; });
    this.parts.each(p => { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; if (p.t >= p.life) p.alive = false; });
    if (this.toast) { this.toast.t += dt; if (this.toast.t > this.toast.dur) this.toast = null; }
    const s = this.stats; s.overload = Math.max(0, s.overload - CFG.overloadDecay * dt * (this.mode === 'street' ? 0.4 : 1));
    if (this.center) this.center.t += dt;
    if (this.line) this.line.t += dt;
    if (this.debug && this.state && Input.pressed.has('KeyN') && !this.trans) S[this.state].debugSkip ? S[this.state].debugSkip.call(this) : this.complete();
    if (Input.pressed.has('Backquote') || Input.pressed.has('F2')) this.debug = !this.debug;
    if (Input.pressed.has('KeyM') && !(this.debug && this.mode === 'kal')) { Music.muted = !Music.muted; this.say(Music.muted ? 'Music off (M)' : 'Music on (M)', 1.2); }
  },
  say(text, dur = 2.2) { this.toast = { text, t: 0, dur }; },
  triggerGameOver(reason) {
    if (this.gameOver) return;
    this.gameOver = { reason, t: 0 }; Audio.sfx('gameover'); Audio.ambience({}, 1.5);
  },
  retry() {
    const s = Save.read(); this.gameOver = null; this.trans = null; this.snapshot = null;
    this.waves.clear(); this.fx.clear(); this.pulses.clear(); this.parts.clear();
    if (s) this.loadSave(s); else this.newGame();
  },

  /* ---------------- camera ---------------- */
  roomFitZoom() { return Math.min(this.W / ROOM.w, this.H / ROOM.h); },
  // daytime room: closer framing that follows Ben, never showing past the plate edges
  roomCam(dt, snap) {
    const z = Math.max(this.roomFitZoom() * CFG.roomZoom, Math.max(this.W / ROOM.w, this.H / ROOM.h));
    const b = this.ben, vw = this.W / z, vh = this.H / z;
    const fx = b.asleep ? b.x + 120 : b.x, fy = b.asleep ? b.y + 90 : b.y - b.h * 0.45;
    const x = clamp(fx, vw / 2, ROOM.w - vw / 2), y = clamp(fy, vh / 2, ROOM.h - vh / 2);
    if (snap) Object.assign(this.cam, { x, y, z }); else this.camTo(x, y, z, 3, dt);
  },
  applyCam() { const c = this.cam, d = this.dpr; this.ctx.setTransform(d * c.z, 0, 0, d * c.z, d * (this.W / 2 - c.x * c.z), d * (this.H / 2 - c.y * c.z)); },
  screenToWorld(x, y) { const c = this.cam; return [(x - this.W / 2) / c.z + c.x, (y - this.H / 2) / c.z + c.y]; },
  worldToScreen(x, y) { const c = this.cam; return [(x - c.x) * c.z + this.W / 2, (y - c.y) * c.z + this.H / 2]; },
  camTo(x, y, z, k, dt) { const a = 1 - Math.exp(-k * dt); this.cam.x = lerp(this.cam.x, x, a); this.cam.y = lerp(this.cam.y, y, a); this.cam.z = lerp(this.cam.z, z, a); },

  /* ---------------- movement helpers ---------------- */
  moveBen(dt, speed, canStand) {
    let m = Input.move(); const b = this.ben;
    if (m.x || m.y) this.walkTarget = null;
    else if (this.walkTarget) { // click / tap to walk
      const t = this.walkTarget, dx = t.x - b.x, dy = t.y - b.y, d = Math.hypot(dx, dy);
      if ((d < 10 || t.stuck > 0.25) && t.path && t.path.length && t.stuck <= 0.25) { const n = t.path.shift(); t.x = n[0]; t.y = n[1]; m = { x: 0, y: 0 }; }
      else if (d < 10 || t.stuck > 0.25) { this.walkTarget = null; if (t.act) this.actOnArrive = true; }
      else m = { x: dx / d, y: dy / d };
    }
    b.moving = m.x !== 0 || m.y !== 0;
    if (!b.moving) return;
    b.dir = dirFromVec(m.x, m.y); b.phase += dt;
    const ox = b.x, oy = b.y;
    const nx = b.x + m.x * speed * dt, ny = b.y + m.y * speed * dt;
    if (canStand(nx, ny)) { b.x = nx; b.y = ny; }
    else if (canStand(nx, b.y)) b.x = nx;
    else if (canStand(b.x, ny)) b.y = ny;
    else { // narrow diagonal corridors: slide along the nearest open heading (±35°, ±70°)
      const a0 = Math.atan2(m.y, m.x);
      for (const da of [0.6, -0.6, 1.2, -1.2]) { const ax = b.x + Math.cos(a0 + da) * speed * dt * 0.8, ay = b.y + Math.sin(a0 + da) * speed * dt * 0.8; if (canStand(ax, ay)) { b.x = ax; b.y = ay; break; } }
    }
    if (this.walkTarget) { if (Math.hypot(b.x - ox, b.y - oy) < speed * dt * 0.2) this.walkTarget.stuck += dt; else this.walkTarget.stuck = 0; }
  },
  // click/tap-to-walk path: straight line if clear, else shortest route through the scene's walk nodes
  planPath(fx, fy, tx, ty) {
    const can = this.mode === 'yard' ? yardCanStand : this.mode === 'street' ? streetCanStand : this.mode === 'kal' ? (x, y) => Kal.can(x, y) : benRoomCanStand;
    const nodes = this.mode === 'yard' ? YARD.nodes : this.mode === 'street' ? this.map.nodes : null;
    const clear = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(d / 12); for (let i = 1; i <= n; i++) { const t = i / n; if (!can(lerp(a[0], b[0], t), lerp(a[1], b[1], t))) return false; } return true; };
    const A = [fx, fy]; let B = [tx, ty];
    if (this.mode === 'kal') return Kal.path(Kal.map, fx, fy, tx, ty);
    if (this.mode === 'street' && this.map.grid) return clear(A, B) && can(tx, ty) ? [B] : gridPath(this.map, fx, fy, tx, ty, clear);
    if (!can(tx, ty) && nodes) { let best = null, bd = 1e9; for (const n of nodes) { const d = Math.hypot(n[0] - tx, n[1] - ty); if (d < bd) { bd = d; best = n; } } if (best && bd < 260) B = best; }
    if (clear(A, B) || !nodes) return [B];
    const pts = [A, B, ...nodes], N = pts.length, distv = new Array(N).fill(1e12), prev = new Array(N).fill(-1), done = new Array(N).fill(false);
    distv[0] = 0;
    for (let it = 0; it < N; it++) {
      let u = -1; for (let i = 0; i < N; i++) if (!done[i] && (u < 0 || distv[i] < distv[u])) u = i;
      if (u < 0 || distv[u] >= 1e12) break; done[u] = true; if (u === 1) break;
      for (let v = 0; v < N; v++) { if (done[v]) continue; const w = Math.hypot(pts[v][0] - pts[u][0], pts[v][1] - pts[u][1]); if (distv[u] + w < distv[v] && clear(pts[u], pts[v])) { distv[v] = distv[u] + w; prev[v] = u; } }
    }
    if (prev[1] < 0) return [B];
    const path = []; for (let v = 1; v > 0; v = prev[v]) path.unshift(pts[v]);
    return path;
  },
  // non-combat clicks/taps: act when an interaction is offered, otherwise walk to the tapped spot
  handleTaps() {
    const battle = this.state === 'LESSER_ENTITIES' || this.state === 'DEMON_BATTLE';
    const q = Input.pointer.tapQueue;
    const pf = S[this.state].prompt, prompt = pf && pf.call(this);
    if (this.actOnArrive) { this.actOnArrive = false; if (prompt) Input.actionTap = true; }
    if (battle || !q.length) return;
    const t = q[q.length - 1];
    if (prompt) { Input.actionTap = true; this.walkTarget = null; return; }
    const [wx, wy] = this.screenToWorld(t.x, t.y);
    if (this.mode === 'kal' && (Kal.choice || Kal.dialog || Kal.hidden || Kal.phase === 'TENT_WAKE' || Kal.phase === 'ARRESTED')) { if (Kal.prompt && Kal.prompt.fn) Input.actionTap = true; return; }
    if (this.mode === 'kal' && Kal.portalCd > 0.5) { this.walkTarget = null; return; } // just arrived on a new map: ignore taps meant for the old one
    if (this.mode === 'kal') { const [px, py] = this.screenToWorld(t.x, t.y); const hit = Kal.pushTargets().find(o => dist(px, py, o.x, o.y) < 90); if (hit) { Kal.pushAt(hit); return; } }
    if (this.mode === 'kal' && Kal.prompt) { const [px, py] = this.screenToWorld(t.x, t.y); const n = Kal.nearestPt; // act only when the tap lands near Ben or the thing offered
      if (dist(px, py, this.ben.x, this.ben.y - 30) < 70 || (n && dist(px, py, n[0], n[1]) < 80)) { Input.actionTap = true; this.walkTarget = null; return; } }
    if (this.mode === 'street') { let hitP = null; this.peds.each(p => { if (p.mode === 'walk' && dist(wx, wy, p.x, p.y - 34) < 55) hitP = p; });
      if (this.sub.foes) this.sub.foes.forEach(f => { if (!f.dying && f.alpha > 0.3 && dist(wx, wy, f.x, f.y) < f.r + 30) hitP = { x: f.x, y: f.y + 34 }; });
      if (hitP) { this.streetFire = { x: hitP.x, y: hitP.y - 34 }; return; } }
    const path = this.planPath(this.ben.x, this.ben.y, wx, wy); const first = path.shift();
    this.walkTarget = { x: first[0], y: first[1], path, act: true, stuck: 0 };
    this.tapMarker = { x: wx, y: wy, t: 0 };
  },
  walkTo(tx, ty, speed, dt) { // scripted walk; returns true on arrival
    const b = this.ben, dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
    if (d < 4) { b.moving = false; return true; }
    const st = Math.min(d, speed * dt); b.x += dx / d * st; b.y += dy / d * st; b.dir = dirFromVec(dx, dy); b.moving = true; b.phase += dt; return false;
  },

  /* ---------------- FX helpers ---------------- */
  spawnFx(anim, x, y, { h = 160, rot = 0, dur = null, vx = 0, vy = 0, alpha = 1, add = true, flip = false } = {}) {
    const a = Assets.anim('vfx', anim); if (!a) return;
    const f = this.fx.get(); Object.assign(f, { anim, x, y, h, rot, t: 0, dur: dur || a.duration, vx, vy, alpha, add, flip });
  },
  sparkle(x, y, n = 40, col = [255, 210, 110]) {
    const r = this.rngFor('sp' + this.time);
    for (let i = 0; i < n; i++) {
      const p = this.parts.get(); const a = r() * TAU, sp = 60 + r() * 220;
      Object.assign(p, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, g: 160, t: 0, life: 0.8 + r() * 0.9, size: 3 + r() * 5, col });
    }
  },

  /* ---------------- rendering ---------------- */
  draw() {
    const ctx = this.ctx, d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.W, this.H);
    if (this.state) {
      this.applyCam();
      if (this.mode === 'room') this.drawRoom();
      else if (this.mode === 'yard') this.drawYard();
      else if (this.mode === 'street') this.drawStreet();
      else if (this.mode === 'kal') Kal.drawWorld(ctx);
      S[this.state].draw && S[this.state].draw.call(this, ctx);
      if (this.walkTarget && this.tapMarker) { const k = this.tapMarker; ctx.save(); ctx.strokeStyle = 'rgba(255,215,120,0.7)'; ctx.lineWidth = 2 / this.cam.z;
        ctx.beginPath(); ctx.ellipse(k.x, k.y, 14 / this.cam.z * 1.5, 7 / this.cam.z * 1.5, 0, 0, TAU); ctx.stroke(); ctx.restore(); }
      this.drawFx(ctx);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      if (this.snapshot) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1 - ease(this.snapshot.t / this.snapshot.dur); ctx.drawImage(this.snapCanvas, 0, 0); ctx.restore(); }
      UI.draw(ctx);
      if (this.mode === 'kal') Kal.drawHud(ctx);
    }
    if (this.trans) {
      const k = this.trans.phase === 'out' ? this.trans.t / this.trans.dur : 1 - this.trans.t / this.trans.dur;
      ctx.fillStyle = `rgba(0,0,0,${clamp(k, 0, 1)})`; ctx.fillRect(0, 0, this.W, this.H);
    }
    if (this.paused) UI.overlay(ctx, 'PAUSED', 'Tap or press any key to resume');
    if (this.gameOver) UI.overlay(ctx, 'THE NIGHT TOOK HIM', this.gameOver.t > 1.2 ? 'Tap / Enter to try the night again' : '', 'rgba(20,0,10,0.8)');
    if (this.debug) UI.debug(ctx);
  },

  // Room: astral-night / day plate, black void extension with an animated edge mask.
  drawRoom() {
    const ctx = this.ctx, R = this.room, t = this.time;
    const L = this.lctx, M = this.mctx, mw = this.mask.width, mh = this.mask.height;
    // 1) mask: plate-rect polygon morphing into the room outline, wobbling edges, feathered via shadow blur
    M.setTransform(1, 0, 0, 1, 0, 0); M.clearRect(0, 0, mw, mh);
    const v = clamp(R.void, 0, 1);
    if (v <= 0.001) { M.fillStyle = '#fff'; M.fillRect(0, 0, mw, mh); }
    else {
      const rect = ROOM.outline.map(([x, y]) => [x < 836 ? -200 : ROOM.w + 200, y < 470 ? -200 : ROOM.h + 200].map((q, i) => lerp(q, [x, y][i], 0.25)));
      const pts = [];
      const n = ROOM.outline.length;
      for (let i = 0; i < n; i++) {
        const a = ROOM.outline[i], b = ROOM.outline[(i + 1) % n], ra = rect[i], rb = rect[(i + 1) % n];
        const ax = lerp(ra[0], a[0], v), ay = lerp(ra[1], a[1], v), bx = lerp(rb[0], b[0], v), by = lerp(rb[1], b[1], v);
        const segs = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 70));
        const nx = -(by - ay), ny = bx - ax, nl = Math.hypot(nx, ny) || 1;
        for (let k = 0; k < segs; k++) {
          const u = k / segs, w = Math.sin(t * 0.9 + (i * 7 + k) * 1.7) * 14 * v + Math.sin(t * 2.3 + k) * 6 * v;
          pts.push([(lerp(ax, bx, u) + nx / nl * w) / 4, (lerp(ay, by, u) + ny / nl * w) / 4]);
        }
      }
      const S2 = this.mask2, s2 = S2.getContext('2d'), k2 = S2.width / mw;
      s2.setTransform(1, 0, 0, 1, 0, 0); s2.clearRect(0, 0, S2.width, S2.height); s2.fillStyle = '#fff';
      s2.beginPath(); pts.forEach(([x, y], i) => i ? s2.lineTo(x * k2, y * k2) : s2.moveTo(x * k2, y * k2)); s2.closePath(); s2.fill();
      M.imageSmoothingEnabled = true; M.drawImage(S2, 0, 0, mw, mh);
    }
    // 2) plate(s) into layer, masked
    L.globalCompositeOperation = 'source-over'; L.globalAlpha = 1; L.clearRect(0, 0, ROOM.w, ROOM.h);
    const night = Assets.img.bg_night, day = Assets.img.bg_day;
    const A = R.plate === 'night' ? night : day, B = R.plate === 'night' ? day : night;
    if (A) L.drawImage(A, 0, 0, ROOM.w, ROOM.h);
    if (R.mix > 0 && B) { L.globalAlpha = R.mix; L.drawImage(B, 0, 0, ROOM.w, ROOM.h); L.globalAlpha = 1; }
    if (R.evening > 0) { L.fillStyle = `rgba(255,120,50,${0.22 * R.evening})`; L.globalCompositeOperation = 'multiply'; L.fillRect(0, 0, ROOM.w, ROOM.h);
      L.globalCompositeOperation = 'source-over'; L.fillStyle = `rgba(40,20,60,${0.18 * R.evening})`; L.fillRect(0, 0, ROOM.w, ROOM.h); }
    L.globalCompositeOperation = 'destination-in'; L.drawImage(this.mask, 0, 0, ROOM.w, ROOM.h); L.globalCompositeOperation = 'source-over';
    // 3) void colour field, then the island
    const [or, og, ob] = R.outer;
    ctx.fillStyle = `rgb(${or},${og},${ob})`; ctx.fillRect(-6000, -6000, 14000, 14000);
    if (v > 0.05 && R.plate === 'night' && R.mix < 0.9) this.drawVoidMotes(ctx, v);
    ctx.drawImage(this.layer, 0, 0);
  },
  drawVoidMotes(ctx, v) {
    const t = this.time; ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const a = i * 2.39996 + t * 0.02 * (i % 3 - 1), r = 1000 + (i * 97 % 1600) + Math.sin(t * 0.3 + i) * 60;
      const x = ROOM.battle[0] + Math.cos(a) * r, y = ROOM.battle[1] + Math.sin(a) * r * 0.62;
      const al = (0.25 + 0.25 * Math.sin(t * 1.3 + i)) * v;
      ctx.fillStyle = i % 4 ? `rgba(90,120,255,${al * 0.5})` : `rgba(80,230,210,${al * 0.6})`;
      ctx.beginPath(); ctx.arc(x, y, 3 + (i % 5), 0, TAU); ctx.fill();
    }
    ctx.restore();
  },
  drawYard() {
    const ctx = this.ctx; const im = Assets.img.bg_yard;
    ctx.fillStyle = '#16200f'; ctx.fillRect(-4000, -4000, 10000, 10000);
    if (im) ctx.drawImage(im, 0, 0, YARD.w, YARD.h);
    if (this.state === 'BACKYARD_EVENING') { ctx.fillStyle = 'rgba(255,110,40,0.18)'; ctx.fillRect(0, 0, YARD.w, YARD.h); ctx.fillStyle = 'rgba(30,20,60,0.2)'; ctx.fillRect(0, 0, YARD.w, YARD.h); }
  },
  drawStreet() {
    const ctx = this.ctx, M = this.map; const m = Assets.meta['map_' + M.key];
    ctx.fillStyle = M.key === 'coastal' ? '#0f3f57' : '#1f2a18'; ctx.fillRect(-2000, -2000, 8000, 8000);
    if (!m) return;
    // exact 512x512 plates at (col-1)*512,(row-1)*512 — no resize, spacing, overlap or perspective
    for (const t of m.tiles) { const im = Assets.img[`tile_${M.key}_${t.row}_${t.col}`]; if (im) ctx.drawImage(im, (t.col - 1) * 512, (t.row - 1) * 512, 512, 512); }
    if (this.debug && M.walk) { ctx.strokeStyle = 'rgba(0,255,120,0.5)'; ctx.lineWidth = 3; M.walk.forEach(r => ctx.strokeRect(r[0], r[1], r[2], r[3]));
      ctx.strokeStyle = 'rgba(255,60,60,0.6)'; M.block.forEach(r => ctx.strokeRect(r[0], r[1], r[2], r[3])); }
    if (this.debug && M.grid) { const G = M.grid; ctx.fillStyle = 'rgba(0,255,120,0.18)'; for (let i = 0; i < G.g.length; i++) if (G.g[i]) ctx.fillRect((i % G.w) * G.cell, ((i / G.w) | 0) * G.cell, G.cell, G.cell); }
  },
  drawFx(ctx) {
    this.fx.each(f => {
      const a = Assets.anim('vfx', f.anim); if (!a) return;
      const n = a.frames.length; let i = Math.floor(f.t / (f.dur / n)); i = a.loop ? i % n : Math.min(i, n - 1);
      const al = f.alpha * (a.loop ? 1 : (f.t / f.dur > 0.7 ? 1 - (f.t / f.dur - 0.7) / 0.3 : 1));
      ctx.save(); if (f.add) ctx.globalCompositeOperation = 'lighter';
      Assets.draw(ctx, 'vfx', a.frames[i], f.x, f.y, { h: f.h, rot: f.rot, alpha: al, flip: f.flip }); ctx.restore();
    });
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    this.parts.each(p => { const k = 1 - p.t / p.life; ctx.fillStyle = `rgba(${p.col[0]},${p.col[1]},${p.col[2]},${k})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + k), 0, TAU); ctx.fill(); });
    ctx.restore();
  },
  drawTitle(dt) {
    const ctx = this.ctx, d = this.dpr; ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = '#05060c'; ctx.fillRect(0, 0, this.W, this.H);
    const t = performance.now() / 1000, sp = this.splash;
    // key-art splash, "cover" fit; on tall screens bias toward the title lettering
    let map = null;
    if (sp && sp.complete && sp.naturalWidth) {
      const portrait = this.W / this.H < 1;
      // landscape: cover; portrait: frame the painted title (x 920..1560, y 190..480) and letterbox above/below
      const k = portrait ? this.W / 780 : Math.max(this.W / sp.naturalWidth, this.H / sp.naturalHeight);
      const ox = portrait ? -850 * k : clamp(this.W / 2 - sp.naturalWidth * k * 0.5, this.W - sp.naturalWidth * k, 0);
      const oy = portrait ? this.H * 0.36 - sp.naturalHeight * k / 2 : (this.H - sp.naturalHeight * k) / 2;
      ctx.drawImage(sp, ox, oy, sp.naturalWidth * k, sp.naturalHeight * k);
      if (portrait) { const g2 = ctx.createLinearGradient(0, oy, 0, oy + 60); g2.addColorStop(0, '#05060c'); g2.addColorStop(1, 'rgba(5,6,12,0)'); ctx.fillStyle = g2; ctx.fillRect(0, oy, this.W, 60);
        const g3 = ctx.createLinearGradient(0, oy + sp.naturalHeight * k - 80, 0, oy + sp.naturalHeight * k); g3.addColorStop(0, 'rgba(5,6,12,0)'); g3.addColorStop(1, '#05060c'); ctx.fillStyle = g3; ctx.fillRect(0, oy + sp.naturalHeight * k - 80, this.W, 80); }
      map = (x, y) => [ox + x * k, oy + y * k];
      const g = ctx.createLinearGradient(0, this.H * 0.72, 0, this.H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = g; ctx.fillRect(0, this.H * 0.72, this.W, this.H * 0.28);
    } else {
      ctx.save(); ctx.translate(this.W / 2, this.H * 0.36);
      drawBen(ctx, 0, 70, Math.min(170, this.H * 0.28), 4, 0, { crownGlow: 0.6 + 0.2 * Math.sin(t * 2) });
      ctx.restore();
      ctx.textAlign = 'center'; ctx.fillStyle = '#e9c46a'; ctx.font = `600 ${Math.min(44, this.W / 12)}px Georgia, serif`;
      ctx.fillText('KING OF ATLANTIS', this.W / 2, this.H * 0.58);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = '#b9c2d8'; ctx.font = '15px system-ui, sans-serif';
    // buttons sit under the painted title (image x≈1240, y≈520) when it's on screen, else bottom-centre
    let cx = this.W / 2, top = this.H * 0.64;
    if (map) { const [mx, my] = map(1250, 560); cx = clamp(mx, 150, this.W - 150); top = Math.min(my, this.H - (Save.read() ? 120 : 70)); }
    if (!this.ready) {
      const bw = Math.min(260, this.W - 60), p = Assets.total ? Assets.loaded / Assets.total : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(ctx, cx - bw / 2, top + 10, bw, 8, 4); ctx.fill();
      ctx.fillStyle = '#e9c46a'; rr(ctx, cx - bw / 2, top + 10, bw * p, 8, 4); ctx.fill();
      ctx.fillStyle = '#d8dbe6'; ctx.fillText('Loading…', cx, top + 42); return;
    }
    const save = Save.read();
    this.titleButtons = [];
    const bw = Math.min(280, this.W - 40), bx = clamp(cx - bw / 2, 20, this.W - bw - 20); let by = top;
    const btn = (label, fn) => { ctx.fillStyle = 'rgba(8,14,26,0.78)'; ctx.strokeStyle = '#e9c46a'; ctx.lineWidth = 1.5; rr(ctx, bx, by, bw, 44, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f3e2b0'; ctx.font = '600 16px system-ui, sans-serif'; ctx.fillText(label, bx + bw / 2, by + 28); this.titleButtons.push({ x: bx, y: by, w: bw, h: 44, fn }); by += 56; };
    if (save) btn(save.state === 'KALALAU' ? `Continue — Act 2: ${save.kal && save.kal.mapId ? save.kal.mapId.replace(/-/g, ' ') : 'Kalalau'}` : `Continue — Day ${save.day}, ${save.state === 'NIGHT_CLOSE' ? 'night' : 'morning'}`, () => this.loadSave(save));
    btn(save ? 'Start over (Act 1, Day 1)' : 'Begin (Act 1)', () => { Save.clear(); this.newGame(); });
    btn('Act 2: Kalalau', () => { Save.clear(); this.startKalalau(); });
    // play-test option (small toggle under the buttons): guinea pig companion in Kalalau
    { const on = KalOpts.pig, tw = 250, tx = bx + bw / 2 - tw / 2, ty = by - 4; ctx.fillStyle = 'rgba(8,14,26,0.7)'; rr(ctx, tx, ty, tw, 30, 8); ctx.fill(); ctx.strokeStyle = on ? '#9fe08a' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = on ? '#c9f5b8' : '#b9c2d8'; ctx.font = '600 13px system-ui, sans-serif'; ctx.fillText(`Test: guinea pig in Kalalau — ${on ? 'ON' : 'OFF'}`, tx + tw / 2, ty + 20);
      this.titleButtons.push({ x: tx, y: ty, w: tw, h: 30, toggle: true, fn: () => { KalOpts.pig = !KalOpts.pig; } });
      const my = ty + 36, mon = !Music.muted; ctx.fillStyle = 'rgba(8,14,26,0.7)'; rr(ctx, tx, my, tw, 30, 8); ctx.fill(); ctx.strokeStyle = mon ? '#9fd0ff' : 'rgba(255,255,255,0.35)'; ctx.stroke();
      ctx.fillStyle = mon ? '#cfe6ff' : '#b9c2d8'; ctx.fillText(`Music — ${mon ? 'ON' : 'OFF'}  (M in game)`, tx + tw / 2, my + 20);
      this.titleButtons.push({ x: tx, y: my, w: tw, h: 30, toggle: true, music: true, fn: () => { Music.muted = !Music.muted; } }); }
    ctx.fillStyle = '#7d869c'; ctx.font = '12px system-ui, sans-serif';
    if (this.W >= 900) ctx.fillText('Move: WASD / arrows / drag · Act or walk: click / E · Fire: click / Space', this.W / 2, this.H - 22);
    else ctx.fillText('Tap to play · best in landscape', this.W / 2, this.H - 14);
    const tap = Input.pointer.tapQueue[0];
    let pick = null;
    if (tap) pick = this.titleButtons.find(b => tap.x >= b.x && tap.x <= b.x + b.w && tap.y >= b.y && tap.y <= b.y + b.h);
    if (Input.pressed.has('Enter')) pick = this.titleButtons[0];
    if (Input.pressed.has('KeyG')) pick = this.titleButtons.find(b => b.toggle && !b.music);
    if (Input.pressed.has('KeyM')) pick = this.titleButtons.find(b => b.music);
    if (pick && pick.toggle) { pick.fn(); Audio.init(); Audio.sfx('squeak'); }
    else if (pick) { Audio.init(); this.started = true; pick.fn(); }
  },
};

/* ================================================================== STATES */
const S = {};
const benRoomCanStand = (x, y) => pointInPoly(x, y, ROOM.floor);

/* ---- NIGHT_CLOSE: close on Ben and the bed; ordinary room ambience dominant ---- */
S.NIGHT_CLOSE = {
  enter() {
    const z = this.roomFitZoom() * 2.3;
    Object.assign(this.room, { plate: 'night', mix: 0, void: 0, outer: [0, 0, 0], evening: 0 });
    Object.assign(this.cam, { x: ROOM.closeCam[0], y: ROOM.closeCam[1], z });
    Object.assign(this.ben, { x: ROOM.sleep[0], y: ROOM.sleep[1], asleep: true, h: CFG.benRoomHeight, pose: 'idle', moving: false, alpha: 1 });
    this.inv.carryingBag = false; this.objective = 'Sleep';
    Audio.ambience({ room: 0.5, astral: 0 }, 2);
    this.waves.clear(); this.pulses.clear();
  },
  update(dt) {
    this.camTo(ROOM.closeCam[0], ROOM.closeCam[1], this.roomFitZoom() * 2.3, 2, dt);
    if (this.stateT > 3) this.complete();
  },
  draw(ctx) { drawRoomActors.call(this, ctx); },
  exitFade: { fade: 0 },
};

/* ---- ASTRAL_REVEAL: sounds from beyond the walls, eased zoom-out per event, void grows ---- */
S.ASTRAL_REVEAL = {
  enter() {
    this.sub = { events: [1.0, 2.9, 4.8, 6.6, 8.3], names: ['pressure', 'distant', 'tonal', 'impact', 'pulse'], idx: 0,
      zooms: [2.3, 1.75, 1.3, 0.95, 0.7, 0.5], voids: [0, 0.3, 0.55, 0.75, 0.9, 1], step: 0, rise: null };
    this.objective = '…';
  },
  update(dt) {
    const s = this.sub, fit = this.roomFitZoom();
    if (s.idx < s.events.length && this.stateT >= s.events[s.idx]) {
      Audio.sfx(s.names[s.idx]); s.idx++; s.step = s.idx;
      Audio.ambience({ room: 0.5 * (1 - s.idx / 5), astral: 0.5 * s.idx / 5 }, 1.2);
    }
    // each sound event eases the camera farther out (toward the room centre) and deepens the void
    const zt = s.zooms[s.step] * fit;
    const cx = lerp(ROOM.closeCam[0], ROOM.battle[0], s.step / 5), cy = lerp(ROOM.closeCam[1], ROOM.battle[1] - 30, s.step / 5);
    this.camTo(cx, cy, zt, 1.4, dt);
    this.room.void = lerp(this.room.void, s.voids[s.step], 1 - Math.exp(-1.5 * dt));
    // composition established -> Ben rises and takes his stance in the middle of the floor
    const composed = s.idx >= 5 && this.stateT > 10.2 && Math.abs(this.cam.z - zt) < zt * 0.03;
    if (composed && !s.rise) { s.rise = { t: 0 }; this.ben.asleep = false; this.ben.x = ROOM.stand[0]; this.ben.y = ROOM.stand[1]; this.ben.dir = 4; }
    if (s.rise) { s.rise.t += dt; if (this.walkTo(ROOM.battle[0], ROOM.battle[1], 260, dt) && s.rise.t > 1.4) this.complete(); }
  },
  draw(ctx) { drawRoomActors.call(this, ctx); },
  exitFade: { fade: 0 },
};

function drawRoomActors(ctx) {
  const b = this.ben;
  if (b.asleep) {
    if (this.state === 'DREAM') ctx.globalAlpha = 1;
    drawBenAsleep(ctx, b.x, b.y, b.h, Math.sin(this.time * 1.6));
    if (Assets.has('ben_gold')) { // tuck him in: redraw the blanket from the room plate over his lower body, plus a soft body lump
      const poly = ROOM.blanket; ctx.save(); ctx.beginPath(); poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.clip();
      ctx.drawImage(this.layer, 0, 0);
      const br = 1 + Math.sin(this.time * 1.6) * 0.02;
      ctx.save(); ctx.translate(455, 400); ctx.rotate(0.5); ctx.scale(br, br);
      const g = ctx.createLinearGradient(0, -55, 0, 55); g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 118, 50, 0, 0, TAU); ctx.fill(); ctx.restore(); ctx.restore();
    }
    return;
  }
  const battle = this.state === 'LESSER_ENTITIES' || this.state === 'DEMON_BATTLE';
  if (battle || this.state === 'ASTRAL_REVEAL') { // his body stays asleep in bed; the astral form is the one that got up
    drawBodyAsleep.call(this, ctx); drawAstralBen.call(this, ctx, b); return;
  }
  ctx.save(); ctx.globalAlpha = b.alpha;
  drawBen(ctx, b.x, b.y, b.h, b.dir, b.phase, { moving: b.moving, pose: b.pose, poseT: b.poseT, bag: this.inv.carryingBag, crownGlow: battle ? 0.9 : 0 });
  ctx.restore();
}
function drawBodyAsleep(ctx) {
  drawBenAsleep(ctx, ROOM.sleep[0], ROOM.sleep[1], CFG.benRoomHeight, Math.sin(this.time * 1.6));
  if (Assets.has('ben_gold')) { const poly = ROOM.blanket; ctx.save(); ctx.beginPath(); poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.clip(); ctx.drawImage(this.layer, 0, 0); ctx.restore(); }
}
// astral form: Ben drawn to an offscreen canvas, tinted spirit-blue, shown translucent with a soft glow and a faint silver cord back to the body
let _astralCanvas = null;
function drawAstralBen(ctx, b) {
  const S = Math.ceil(b.h * 3.2);
  if (!_astralCanvas || _astralCanvas.width !== S) { _astralCanvas = document.createElement('canvas'); _astralCanvas.width = S; _astralCanvas.height = S; }
  const a = _astralCanvas.getContext('2d'); a.setTransform(1, 0, 0, 1, 0, 0); a.globalCompositeOperation = 'source-over'; a.globalAlpha = 1; a.clearRect(0, 0, S, S);
  drawBen(a, S / 2, S * 0.78, b.h, b.dir, b.phase, { moving: b.moving, pose: b.pose, poseT: b.poseT, crownGlow: 0.9 });
  a.globalCompositeOperation = 'source-atop'; a.fillStyle = 'rgba(90,170,255,0.52)'; a.fillRect(0, 0, S, S); a.globalCompositeOperation = 'source-over';
  const bob = Math.sin(this.time * 2.1) * 4;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(170,215,255,0.22)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ROOM.sleep[0] + 40, ROOM.sleep[1] + 10);
  ctx.quadraticCurveTo((ROOM.sleep[0] + b.x) / 2, Math.min(ROOM.sleep[1], b.y) - 120, b.x, b.y - b.h * 0.5 + bob); ctx.stroke();
  const g = ctx.createRadialGradient(b.x, b.y - b.h * 0.5, 10, b.x, b.y - b.h * 0.5, b.h * 0.8); g.addColorStop(0, 'rgba(110,180,255,0.28)'); g.addColorStop(1, 'rgba(110,180,255,0)');
  ctx.fillStyle = g; ctx.fillRect(b.x - b.h, b.y - b.h * 1.4, b.h * 2, b.h * 2); ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.72 * b.alpha; ctx.drawImage(_astralCanvas, b.x - S / 2, b.y - S * 0.78 + bob);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.18 * b.alpha; ctx.drawImage(_astralCanvas, b.x - S / 2, b.y - S * 0.78 + bob); ctx.restore();
}

/* ------------------------------------------------------------------ psychic combat (shared by lesser + demon) */
const Combat = {
  reset(g) { g.combat = { state: 'ready', t: 0, aim: -Math.PI / 2, hitFlash: 0, lastPress: -9 }; },
  aimFromInput(g) {
    const c = g.combat; const b = g.ben; const hx = b.x, hy = b.y - b.h * 0.55;
    if (Input.pointer.moved || Input.pointer.tapQueue.length) {
      const p = Input.pointer.tapQueue.length ? Input.pointer.tapQueue[Input.pointer.tapQueue.length - 1] : Input.pointer;
      const [wx, wy] = g.screenToWorld(p.x, p.y); c.aim = Math.atan2(wy - hy, wx - hx);
    }
    const m = Input.move(); if (m.x || m.y) c.aim = Math.atan2(m.y, m.x);
    Input.pointer.moved = false;
  },
  update(g, dt, targets) {
    const c = g.combat, b = g.ben;
    this.aimFromInput(g);
    b.dir = dirFromVec(Math.cos(c.aim), Math.sin(c.aim));
    c.t += dt;
    if (Input.fire()) {
      if (c.state === 'ready') {
        if (g.stats.astral < CFG.shotCost) { Audio.sfx('empty'); g.say('No astral energy left'); }
        else { c.state = 'windup'; c.t = 0; b.pose = 'cast'; b.poseT = 0; Audio.sfx('charge'); }
      } else { Audio.sfx('empty'); c.denied = 0.3; } // no buffering: spamming does nothing
    }
    if (c.denied) c.denied = Math.max(0, c.denied - dt);
    if (c.state === 'windup' && c.t >= CFG.windup) {
      c.state = 'cooldown'; c.t = 0; g.stats.astral -= CFG.shotCost; g.stats.overload = Math.min(100, g.stats.overload + CFG.overloadPerShot);
      const w = g.waves.get(); const hx = b.x + Math.cos(c.aim) * 40, hy = b.y - b.h * 0.55 + Math.sin(c.aim) * 40;
      Object.assign(w, { x: hx, y: hy, vx: Math.cos(c.aim) * CFG.waveSpeed, vy: Math.sin(c.aim) * CFG.waveSpeed, ang: c.aim, trav: 0, age: 0 });
      Audio.sfx('launch'); g.shots = (g.shots || 0) + 1;
    }
    const cd = CFG.cooldown * (g.stats.overload >= 100 ? 2 : 1);
    if (b.pose === 'cast') { b.poseT = c.state === 'windup' ? c.t : 0.27 + c.t; if (c.state === 'cooldown' && c.t > 0.3) b.pose = 'idle'; }
    if (b.pose === 'brace') { b.poseT = (b.poseT || 0) + dt; if (b.poseT > 0.6) b.pose = 'idle'; }
    if (c.state === 'cooldown' && c.t >= cd) { c.state = 'ready'; c.t = 0; if (b.pose === 'cast') b.pose = 'idle'; }
    // travel + hit tests
    g.waves.each(w => {
      w.age += dt; w.x += w.vx * dt; w.y += w.vy * dt; w.trav += CFG.waveSpeed * dt;
      if (w.trav > CFG.waveRange) { w.alive = false; g.misses = (g.misses || 0) + 1; return; }
      for (const tg of targets) {
        if (!tg.hittable()) continue;
        if (dist(w.x, w.y, tg.x, tg.y) < tg.r) { w.alive = false; g.spawnFx('impact', w.x, w.y, { h: 200 }); tg.onHit(w); return; }
      }
    });
  },
  cooldownFrac(g) {
    const c = g.combat; if (!c) return 1;
    if (c.state === 'ready') return 1; if (c.state === 'windup') return 0;
    return clamp(c.t / (CFG.cooldown * (g.stats.overload >= 100 ? 2 : 1)), 0, 1);
  },
  draw(g, ctx) {
    const c = g.combat, b = g.ben; if (!c) return;
    const hx = b.x, hy = b.y - b.h * 0.55;
    // aim guide (short, restrained)
    ctx.save(); ctx.strokeStyle = 'rgba(255,215,120,0.35)'; ctx.lineWidth = 3 / g.cam.z * 0.6; ctx.setLineDash([14, 14]);
    ctx.beginPath(); ctx.moveTo(hx + Math.cos(c.aim) * 70, hy + Math.sin(c.aim) * 70); ctx.lineTo(hx + Math.cos(c.aim) * 260, hy + Math.sin(c.aim) * 260); ctx.stroke(); ctx.restore();
    if (c.state === 'windup') {
      const fr = Assets.animFrame('vfx', 'charge', c.t);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      Assets.draw(ctx, 'vfx', fr, hx + Math.cos(c.aim) * 50, hy + Math.sin(c.aim) * 50, { h: 70 + 90 * c.t / CFG.windup }); ctx.restore();
    }
    g.waves.each(w => {
      const fr = Assets.animFrame('vfx', 'wave', w.age);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; Assets.draw(ctx, 'vfx', fr, w.x, w.y, { h: 190, rot: w.ang }); ctx.restore();
    });
  },
};

/* ---- LESSER_ENTITIES: one at a time, varied sides, readable approach ---- */
S.LESSER_ENTITIES = {
  enter() {
    Combat.reset(this);
    const r = this.rngFor('lesser');
    const sides = ['E', 'W', 'N', 'S'];
    for (let i = sides.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [sides[i], sides[j]] = [sides[j], sides[i]]; }
    const types = [0, 1, 2, 3]; // weak first, brute last
    const plan = []; for (let i = 0; i < CFG.lesserEncounters; i++) plan.push({ type: LESSER_TYPES[types[i % 4]], side: sides[i % 4], jit: (r() - 0.5) * 0.7 });
    this.sub = { plan, idx: 0, cur: null, silence: 1.2, resolved: 0, sidesUsed: [] };
    this.objective = this.nightK() > 1 ? "Hold the room — they're faster tonight" : 'Hold the room';
    Object.assign(this.ben, { x: ROOM.battle[0], y: ROOM.battle[1], asleep: false, pose: 'idle', moving: false, h: CFG.benRoomHeight });
    Object.assign(this.room, { void: 1, plate: 'night', mix: 0 });
    Audio.ambience({ astral: 0.55, room: 0.05 }, 1);
  },
  update(dt, live) {
    const s = this.sub, b = this.ben;
    this.camTo(ROOM.battle[0], ROOM.battle[1] - 30, Math.min(this.W / (2 * 1400), this.H / (2 * 1400 * 0.62 + 380)) * CFG.battleZoom, 0.9, dt);
    const e = s.cur;
    const target = e && !e.dying ? [{ x: e.x, y: e.y, r: e.type.radius, hittable: () => e.alpha > 0.35, onHit: () => {
      e.hp--; e.hitT = 0.45; Audio.sfx('hit');
      if (e.hp <= 0) { e.dying = true; e.dieT = 0; Audio.sfx('dissolve'); this.stats.astral = Math.min(100, this.stats.astral + CFG.killRestore);
        for (let i = 0; i < 4; i++) this.spawnFx('wisp', e.x + (i - 1.5) * 40, e.y, { h: 150, vy: -60 - i * 20, dur: 1.2, alpha: 0.8 }); }
    } }] : [];
    if (live) Combat.update(this, dt, target);
    if (!e) {
      if (s.idx >= s.plan.length) { if (this.waves.count() === 0) this.complete(); return; }
      s.silence -= dt;
      if (s.silence <= 0) { // spawn the next entity beyond one side of the room, in the blackness
        const p = s.plan[s.idx++]; const base = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 }[p.side] + p.jit;
        const R = 1500; const x = ROOM.battle[0] + Math.cos(base) * R, y = ROOM.battle[1] + Math.sin(base) * R * 0.66;
        s.cur = { type: p.type, side: p.side, hp: p.type.hp, x, y, vx: 0, vy: 0, alpha: 0, hitT: 0, dying: false, dieT: 0, t: 0, seed: s.idx * 3.1, stalkT: 0 };
        s.sidesUsed.push(p.side); Audio.sfx('distant');
      }
      return;
    }
    e.t += dt;
    if (e.dying) {
      e.dieT += dt; e.alpha = Math.max(0, 1 - e.dieT / 1.0);
      if (e.dieT > 1.1) { s.cur = null; s.resolved++; s.silence = CFG.lesserSilence; }
      return;
    }
    e.alpha = Math.min(1, e.alpha + dt / 1.4);
    const dx = b.x - e.x, dy = (b.y - b.h * 0.45) - e.y, d = Math.hypot(dx, dy);
    if (e.hitT > 0) { e.hitT -= dt; e.x -= dx / d * 240 * dt; e.y -= dy / d * 240 * dt; return; } // pause + recoil
    let sp = e.type.speed * this.nightK();
    if (e.type.stalk) { e.stalkT += dt; if (e.stalkT % 2.0 > 1.25) sp = 0; }
    const px = -dy / d, py = dx / d, weave = Math.sin(e.t * 2.2 * this.nightK()) * e.type.weave;
    e.vx = dx / d * sp + px * weave; e.vy = dy / d * sp + py * weave;
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (d < e.type.radius * 0.6 + 45) { // reached Ben: drains defence and bursts
      if (this.stats.astral <= 0) { this.triggerGameOver('overrun'); return; }
      this.stats.astral = Math.max(0, this.stats.astral - CFG.lesserContactDrain); this.stats.health = Math.max(0, this.stats.health - 5);
      Audio.sfx('drain'); this.spawnFx('bubble', b.x, b.y - b.h * 0.5, { h: 300, dur: 0.6 });
      if (this.stats.astral <= 0) this.spawnFx('break', b.x, b.y - b.h * 0.5, { h: 300 });
      e.dying = true; e.dieT = 0; b.pose = 'brace'; b.poseT = 0; this.say('It got through — defence drained');
    }
  },
  draw(ctx) {
    drawRoomActors.call(this, ctx);
    const e = this.sub.cur;
    if (e) drawLesser(ctx, e, this.time);
    Combat.draw(this, ctx);
  },
  debugSkip() { this.sub.plan.length = this.sub.idx; if (this.sub.cur) { this.sub.cur.dying = true; this.sub.cur.dieT = 0.9; } },
  exitFade: { fade: 0 },
};

/* ---- DEMON_BATTLE: one demon, five concentric orbits, five hits ---- */
S.DEMON_BATTLE = {
  enter() {
    if (!this.combat) Combat.reset(this);
    Object.assign(this.ben, { x: ROOM.battle[0], y: ROOM.battle[1], asleep: false, h: CFG.benRoomHeight, pose: 'idle', moving: false });
    Object.assign(this.room, { void: 1, plate: 'night', mix: 0 });
    const r = this.rngFor('demon');
    const d = { hits: 0, ang: r() * TAU, dirSign: r() < 0.5 ? 1 : -1, r: CFG.demonOrbitsRX[0] * 1.35, targetR: CFG.demonOrbitsRX[0],
      lean: 0, mode: 'enter', t: 0, flap: 0, alpha: 0, heading: 0, x: 0, y: 0, nextPulse: 3.5, nextFeint: 6 + r() * 2, flare: 0, invuln: 0, dieT: 0, r0: r,
      orbitsVisited: [1], reversals: 0 };
    this.sub = { d, victoryT: -1 };
    this.objective = 'Break the demon';
    Audio.sfx('growl'); Audio.ambience({ astral: 0.75 }, 1.5);
    this.placeDemon(d, 0);
  },
  update(dt, live) {
    const s = this.sub, d = s.d, b = this.ben, rng = d.r0;
    const orbitR = Math.max(d.r, CFG.demonOrbitsRX[Math.min(d.hits, 4)]);
    this.camTo(ROOM.battle[0], ROOM.battle[1] - 30, Math.min(this.W / (2 * (orbitR + 300)), this.H / (2 * (orbitR * CFG.demonOrbitRYRatio + 330))) * CFG.demonZoom, 0.8, dt);
    if (s.victoryT >= 0) {
      s.victoryT += dt;
      if (s.victoryT > 4.2) this.complete();
      return;
    }
    const targets = d.mode === 'dying' || d.mode === 'gone' ? [] : [{ x: d.x, y: d.y, r: CFG.demonHitRadius, hittable: () => d.invuln <= 0 && d.alpha > 0.5, onHit: () => this.hitDemon(d) }];
    // demon pressure pulses can be shot down too
    this.pulses.each(p => targets.push({ x: p.x, y: p.y, r: 70, hittable: () => true, onHit: () => { p.alive = false; this.spawnFx('impact', p.x, p.y, { h: 120 }); } }));
    if (live) Combat.update(this, dt, targets);
    d.t += dt; d.flap += dt; d.invuln = Math.max(0, d.invuln - dt);
    const speed = CFG.demonAngSpeed[Math.min(d.hits, 4)] * this.nightK();
    switch (d.mode) {
      case 'enter':
        d.alpha = Math.min(1, d.t / 2); d.r = lerp(d.r, d.targetR, 1 - Math.exp(-1.2 * dt)); d.ang += d.dirSign * speed * dt;
        if (d.t > 2.6) { d.mode = 'orbit'; d.t = 0; }
        break;
      case 'recoil':
        d.lean = lerp(d.lean, -0.12, 1 - Math.exp(-8 * dt)); d.ang += d.dirSign * speed * 0.3 * dt;
        if (d.t > 0.55) { d.mode = 'orbit'; d.t = 0; }
        break;
      case 'orbit':
        d.ang += d.dirSign * speed * dt; d.lean = lerp(d.lean, 0, 1 - Math.exp(-4 * dt));
        d.r = lerp(d.r, d.targetR, 1 - Math.exp(-1.6 * dt)); // glide to the next smaller orbit (no teleport)
        d.nextPulse -= dt; d.nextFeint -= dt;
        if (d.nextPulse <= 0 && d.hits < 4) { d.nextPulse = 4.2 + rng() * 2.2; this.firePulse(d); }
        if (d.hits >= 4 && d.t > 2.4 + rng() * 0.6 && Math.abs(d.r - d.targetR) < 30) { d.mode = 'lungeWarn'; d.t = 0; Audio.sfx('lunge'); this.say('It is coming in — hit it!', 1.6); }
        else if (d.hits < 4 && d.nextFeint <= 0) { d.mode = 'feintWarn'; d.t = 0; Audio.sfx('growl'); }
        break;
      case 'feintWarn':
        d.flare = Math.min(1, d.t / 0.7); d.ang += d.dirSign * speed * 0.5 * dt;
        if (d.t > 0.75) { d.mode = this.stats.astral <= 0 ? 'lunge' : 'feint'; d.t = 0; if (d.mode === 'lunge') this.say('Your defence is gone…', 1.6); }
        break;
      case 'feint': { // lean inward, hold, return — readable, never a teleport
        const k = d.t < 0.5 ? ease(d.t / 0.5) : d.t < 0.8 ? 1 : 1 - ease((d.t - 0.8) / 0.6);
        d.lean = 0.5 * k; d.ang += d.dirSign * speed * 0.4 * dt;
        if (d.t > 1.4) { d.mode = 'orbit'; d.t = 0; d.flare = 0; d.nextFeint = 5 + rng() * 3; }
        break;
      }
      case 'lungeWarn':
        d.flare = Math.min(1, d.t / 1.2); d.ang += d.dirSign * speed * 0.35 * dt;
        if (d.t > 1.3) { d.mode = 'lunge'; d.t = 0; }
        break;
      case 'lunge':
        d.lean = Math.min(1, d.lean + dt / 1.8 * (0.4 + d.t) * Math.sqrt(this.nightK())); // accelerating final inward lunge
        if (d.lean >= 0.985) { this.triggerGameOver('demon reached Ben'); return; }
        break;
      case 'dying':
        d.dieT += dt; d.alpha = Math.max(0, 1 - d.dieT / 1.8);
        if (d.dieT > 2.2) { d.mode = 'gone'; s.victoryT = 0; Audio.ambience({ astral: 0, room: 0.2 }, 2.5); Audio.sfx('victory'); this.center = { text: 'MADE IT THROUGH ANOTHER NIGHT', t: 0, dur: 4.2 }; }
        break;
    }
    const px = d.x, py = d.y; this.placeDemon(d, dt);
    if (dt > 0 && (d.x !== px || d.y !== py)) d.heading = Math.atan2(d.y - py, d.x - px);
    // physical contact = game over
    if (d.mode !== 'dying' && d.mode !== 'gone' && dist(d.x, d.y, b.x, b.y - b.h * 0.5) < 95) { this.triggerGameOver('demon reached Ben'); return; }
    // pulses
    this.pulses.each(p => {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (dist(p.x, p.y, b.x, b.y - b.h * 0.5) < 80) {
        p.alive = false; this.stats.astral = Math.max(0, this.stats.astral - CFG.demonPulseDrain); Audio.sfx('drain');
        this.spawnFx('bubble', b.x, b.y - b.h * 0.5, { h: 300, dur: 0.5 });
        if (this.stats.astral <= 0) { this.spawnFx('break', b.x, b.y - b.h * 0.5, { h: 300 }); this.say('Defence broken — its next lunge will be fatal', 2.5); }
      }
      if (p.t > 6) p.alive = false;
    });
    this.stats.fatigue = Math.min(100, this.stats.fatigue + dt * 0.4);
  },
  draw(ctx) {
    const d = this.sub.d;
    if (this.debug) { // orbit guides
      ctx.save(); ctx.strokeStyle = 'rgba(255,120,200,0.35)'; ctx.lineWidth = 2 / this.cam.z;
      CFG.demonOrbitsRX.forEach((rx, i) => { ctx.setLineDash(i === Math.min(d.hits, 4) ? [] : [8 / this.cam.z, 8 / this.cam.z]); ctx.beginPath(); ctx.ellipse(ROOM.battle[0], ROOM.battle[1] - this.ben.h * 0.5, rx, rx * CFG.demonOrbitRYRatio, 0, 0, TAU); ctx.stroke(); });
      ctx.restore();
    }
    drawRoomActors.call(this, ctx);
    this.pulses.each(p => { ctx.save(); ctx.globalCompositeOperation = 'lighter'; Assets.draw(ctx, 'vfx', Assets.animFrame('vfx', 'sonic', p.t), p.x, p.y, { h: 130, rot: p.ang }); ctx.restore(); });
    if (d.mode !== 'gone') drawDemon(ctx, d.x, d.y, 420, d.hits, d.heading, d.flap, { flare: d.flare, lean: Math.max(0, d.lean), lunging: d.mode === 'lunge', alpha: d.alpha, dying: d.mode === 'dying', dieT: d.dieT });
    if (d.mode === 'dying' || (d.hits >= 3 && d.mode !== 'gone')) this.demonVapor(d);
    Combat.draw(this, ctx);
  },
  debugSkip() { const d = this.sub.d; if (d.mode === 'gone') { this.sub.victoryT = 99; return; } d.invuln = 0; this.hitDemon(d); },
  exitFade: { fade: 0 },
};
Game.placeDemon = function (d) {
  const k = 1 - d.lean;
  d.x = ROOM.battle[0] + Math.cos(d.ang) * d.r * k;
  d.y = ROOM.battle[1] - this.ben.h * 0.5 + Math.sin(d.ang) * d.r * CFG.demonOrbitRYRatio * k;
};
Game.firePulse = function (d) {
  const b = this.ben, p = this.pulses.get(); const tx = b.x, ty = b.y - b.h * 0.5; const a = Math.atan2(ty - d.y, tx - d.x);
  Object.assign(p, { x: d.x, y: d.y, vx: Math.cos(a) * 430, vy: Math.sin(a) * 430, ang: a, t: 0 }); Audio.sfx('pulse');
};
Game.hitDemon = function (d) {
  if (d.mode === 'dying' || d.mode === 'gone') return;
  d.hits++; d.invuln = 0.6; d.flare = 0; Audio.sfx('hit'); Audio.sfx('fracture');
  this.demonHitsLog = (this.demonHitsLog || []).concat([{ hit: d.hits, orbitBefore: Math.round(d.targetR) }]);
  if (d.hits >= 5) {
    d.mode = 'dying'; d.dieT = 0; Audio.sfx('shatter');
    const b = this.ben, a = Math.atan2(d.y - (b.y - b.h * 0.5), d.x - b.x);
    this.spawnFx('fists', b.x + Math.cos(a) * 160, b.y - b.h * 0.5 + Math.sin(a) * 160, { h: 260, rot: a, dur: 0.7, vx: Math.cos(a) * 500, vy: Math.sin(a) * 500 });
    this.spawnFx('break', d.x, d.y, { h: 420, dur: 1.0 }); this.spawnFx('impact', d.x, d.y, { h: 480, dur: 0.8 });
    for (let i = 0; i < 6; i++) this.spawnFx('wisp', d.x + (i - 2.5) * 50, d.y, { h: 200, vy: -80 - i * 15, dur: 1.8 });
    this.pulses.clear(); return;
  }
  // next smaller orbit; may reverse direction (readable), never teleports
  d.targetR = CFG.demonOrbitsRX[d.hits]; d.orbitsVisited.push(d.hits + 1);
  if (d.r0() < 0.5) { d.dirSign *= -1; d.reversals++; }
  d.mode = 'recoil'; d.t = 0; d.nextFeint = 4 + d.r0() * 3; d.nextPulse = Math.max(d.nextPulse, 2.5);
  this.say(['First fracture', 'Deeper fracture', 'It is coming apart', 'Nearly broken — it will lunge'][d.hits - 1], 1.6);
};
Game.demonVapor = function (d) {
  if (this.parts.count() > 100) return;
  const r = Math.random; const p = this.parts.get();
  Object.assign(p, { x: d.x + (r() - 0.5) * 120, y: d.y + (r() - 0.5) * 140, vx: (r() - 0.5) * 40, vy: -40 - r() * 60, g: 0, t: 0, life: 1.2, size: 6 + r() * 8, col: d.mode === 'dying' ? [255, 200, 120] : [190, 90, 200] });
};

/* ---- DAWN: astral-night plate crossfades to the day plate; Ben asleep ---- */
S.DAWN = {
  enter() {
    Object.assign(this.ben, { x: ROOM.sleep[0], y: ROOM.sleep[1], asleep: true, pose: 'idle', moving: false });
    this.waves.clear(); this.pulses.clear(); this.combat = null;
    this.sub = { dur: 4.5 }; this.objective = 'Dawn';
    Audio.ambience({ morning: 0.5, room: 0.35, astral: 0 }, 3);
    // a night survived: modest recovery; battle damage to astral defence carries into the morning
    const s = this.stats; s.health = Math.min(100, s.health + 20); s.fatigue = Math.max(15, s.fatigue - 45); s.overload = 0;
    s.astral = Math.min(100, s.astral + 5); s.money += CFG.dailyIncome; s.hunger = Math.min(100, s.hunger + 15);
  },
  update(dt) {
    const k = clamp(this.stateT / this.sub.dur, 0, 1), e = ease(k);
    this.room.mix = e; this.room.outer = [Math.round(18 * e), Math.round(12 * e), Math.round(8 * e)];
    this.camTo(ROOM.w / 2, ROOM.h / 2, this.roomFitZoom() * 1.6, 1.2, dt);
    if (Math.random() < dt * 0.8 * e) Audio.sfx('bird');
    if (k >= 1) this.complete();
  },
  draw(ctx) { drawRoomActors.call(this, ctx); },
  exit() { this.room.plate = 'day'; this.room.mix = 0; },
  exitFade: { fade: 0 },
};

/* ---- ROOM_MORNING: get up, walk across, interact with the door ---- */
S.ROOM_MORNING = {
  enter() {
    Object.assign(this.room, { plate: 'day', mix: 0, void: 1, outer: [18, 12, 8], evening: 0 });
    Object.assign(this.ben, { x: ROOM.sleep[0], y: ROOM.sleep[1], asleep: true, h: CFG.benRoomHeight, pose: 'idle', moving: false });
    this.roomCam(0, true);
    this.sub = { phase: 'asleep', t: 0 }; this.objective = 'Get out of bed';
    Audio.ambience({ morning: 0.5, room: 0.35 }, 1);
    this.benLine(this.day <= 1 ? 'Okay. Better get up and get some food at Safeway.'
      : 'Made it through another night. Alright… better get to Safeway. Not sure how much longer I can live like this.', 1.2, this.day <= 1 ? 4.5 : 7);
  },
  update(dt, live) {
    const s = this.sub, b = this.ben; s.t += dt;
    this.roomCam(dt);
    if (Math.random() < dt * 0.5) Audio.sfx('bird');
    if (s.phase === 'asleep') { if (live && Input.action()) { s.phase = 'rising'; s.t = 0; b.asleep = false; b.x = ROOM.stand[0] - 60; b.y = ROOM.stand[1] - 40; b.dir = 3; Audio.sfx('bag'); } return; }
    if (s.phase === 'rising') { if (this.walkTo(ROOM.stand[0], ROOM.stand[1], 140, dt) && s.t > 0.8) { s.phase = 'free'; this.objective = 'Walk to the door'; } return; }
    if (!live) return;
    this.moveBen(dt, CFG.benRoomSpeed, benRoomCanStand);
    s.nearDoor = dist(b.x, b.y, ROOM.door[0], ROOM.door[1]) < 95;
    if (s.nearDoor && Input.action()) { Audio.sfx('door'); this.complete(); }
  },
  draw(ctx) { drawRoomActors.call(this, ctx); },
  prompt() { const s = this.sub; if (s.phase === 'asleep') return 'Get up'; if (s.nearDoor) return 'Open the door'; return null; },
  exitFade: { fade: 0.6 },
};

/* ---- Backyard (morning + evening share logic) ---- */
const yardCanStand = (x, y) => pointInPoly(x, y, YARD.walk) && !YARD.block.some(r => x > r[0] && x < r[2] && y > r[1] && y < r[3]);
const yardZoom = g => Math.max(g.W / YARD.w, g.H / YARD.h) * 1.35;
function yardEnter(evening) {
  const start = evening ? YARD.gate : YARD.door;
  Object.assign(this.cam, { x: start[0], y: start[1] - 60, z: yardZoom(this) });
  Object.assign(this.ben, { x: start[0], y: start[1], asleep: false, h: CFG.benYardHeight, dir: evening ? 6 : 4, pose: 'idle', moving: false });
  const withBen = evening && this.inv.pigWithBen; // the little friend walks home through the gate with Ben
  this.sub = { evening, pig: withBen ? { x: start[0] + 50, y: start[1] + 20, state: 'follow', t: 0, facing: -1, eatFrame: 0 } : { x: YARD.hutch[0], y: YARD.hutch[1], state: 'idle', t: 0, facing: 1, eatFrame: 0 },
    noticeT: 0.9, fed: false, feeding: null, walkIn: evening ? 0.8 : 0.6 };
  this.objective = this.inv.carrots > 0 ? 'Feed the guinea pig' : 'Head out the gate';
  if (!evening) this.inv.pigWithBen = false;

  Audio.ambience(evening ? { evening: 0.5, room: 0.1 } : { morning: 0.55 }, 1.2);
}
function yardUpdate(dt, live) {
  const s = this.sub, b = this.ben, p = s.pig;
  const z = yardZoom(this); const vw = this.W / z, vh = this.H / z;
  this.camTo(clamp(b.x, vw / 2, YARD.w - vw / 2), clamp(b.y - 60, vh / 2, YARD.h - vh / 2), z, 3, dt);
  if (s.walkIn > 0) { const v = s.evening ? YARD.walkInGate : YARD.walkInDoor; s.walkIn -= dt; b.x += v[0] * 80 * dt; b.y += v[1] * 80 * dt; b.moving = true; b.phase += dt; b.dir = dirFromVec(v[0], v[1]); return; }
  p.t += dt;
  // guinea pig notices Ben and scurries over
  if (p.state === 'idle') { s.noticeT -= dt; if (s.noticeT <= 0) { p.state = 'run'; Audio.sfx('squeak'); } }
  if (p.bubble) { p.bubble.t += dt; if (p.bubble.t > p.bubble.dur) p.bubble = null; }
  if (p.leaveT > 0) { p.leaveT -= dt; if (p.leaveT <= 0) { p.state = 'leaving'; Audio.sfx('squeak'); } }
  if (p.state === 'leaving') { const tx = YARD.burrow[0], ty = YARD.burrow[1], dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy); p.facing = dx >= 0 ? 1 : -1;
    if (d > 8) { const sp = Math.min(d, 380 * dt); p.x += dx / d * sp; p.y += dy / d * sp; p.alpha = clamp(d / 120, 0, 1); } else { p.state = 'gone'; p.alpha = 0; } }
  if (p.state === 'run' || p.state === 'follow') {
    const tx = b.x + (p.x < b.x ? -55 : 55), ty = b.y + 12; const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    p.facing = dx >= 0 ? 1 : -1;
    if (d > 12) { const sp = Math.min(d, 480 * dt); p.x += dx / d * sp; p.y += dy / d * sp; p.state = 'run'; } else { p.state = 'follow'; p.facing = b.x > p.x ? 1 : -1; }
  }
  if (s.feeding) {
    const f = s.feeding; f.t += dt; b.moving = false; b.dir = p.x < b.x ? 6 : 2;
    if (f.t > 0.5 && p.state !== 'eat') { p.state = 'eat'; Audio.sfx('munch'); }
    if (p.state === 'eat') { p.eatFrame = Math.min(2, Math.floor((f.t - 0.5) / 0.6)); if (f.t > 1.1 && !f.m2) { f.m2 = 1; Audio.sfx('munch'); } }
    if (f.t > 2.3 && !f.reward) {
      f.reward = true; const amt = s.evening ? CFG.feedRestoreEvening : CFG.feedRestoreMorning;
      this.stats.astral = Math.min(100, this.stats.astral + amt); this.sparkle(p.x, p.y - 30, 30); this.propFx = { x: (p.x + b.x) / 2, y: b.y - b.h * 0.6, t: 0 }; Audio.sfx('sparkle');
      this.say(`Warm gold — astral defence +${amt}`); this.feedLog = (this.feedLog || []).concat([{ state: this.state, amt }]);
    }
    if (f.t > 3.0) {
      s.feeding = null; s.fed = true; this.objective = s.evening ? 'Go inside' : 'Head out the gate';
      if (s.evening && this.day === 1) { // after the second carrot of day 1 the guinea pig makes its vow, then goes back to its hiding place
        p.bubble = { text: 'I will journey with you, oh benefactor and lost king!', t: 0, dur: 5 }; Audio.say('I will journey with you, oh benefactor and lost king!', { pitch: 1.7, rate: 1.05 }); Audio.sfx('sparkle'); this.sparkle(p.x, p.y - 30, 30);
        this.pigVow = true; p.state = 'follow'; p.leaveT = 5.2;
      } else if (this.day === 1) { p.state = 'follow'; p.leaveT = 0.6; } // day 1 morning: munch, then scurry off
      else p.state = 'follow'; // day 2: it's coming with him
    }
    return;
  }
  if (!live) return;
  this.moveBen(dt, CFG.benRoomSpeed * 0.95, yardCanStand);
  s.nearPig = !s.fed && this.inv.carrots > 0 && p.state !== 'idle' && dist(b.x, b.y, p.x, p.y) < 120;
  if (s.nearPig && Input.action()) { this.inv.carrots--; s.feeding = { t: 0 }; this.objective = 'Feeding…'; return; }
  const exit = s.evening ? YARD.door : YARD.gate;
  s.nearExit = dist(b.x, b.y, exit[0], exit[1]) < 80;
  const allowed = s.fed || this.inv.carrots <= 0;
  if (s.nearExit && Input.action()) {
    if (!allowed) this.say('The guinea pig is waiting for a carrot');
    else if (!s.evening && this.day >= 2) { this.inv.pigWithBen = true; Audio.sfx('squeak'); this.say('The guinea pig trots out the gate after him', 2.2); this.pigLog = (this.pigLog || 0) + 1; this.complete(); }
    else { if (s.evening) this.inv.pigWithBen = false; Audio.sfx(s.evening ? 'door' : 'bag'); this.complete(); }
  }
}
function yardDraw(ctx) {
  const s = this.sub, b = this.ben, p = s.pig;
  const items = [{ y: p.y, f: () => { if (p.state === 'gone') return; ctx.save(); ctx.globalAlpha = p.alpha == null ? 1 : p.alpha; drawGuineaPig(ctx, p.x, p.y, 58, p.state === 'leaving' ? 'run' : p.state, p.t, p.facing, p.eatFrame, p.state === 'follow' && !s.fed); ctx.restore();
      if (p.bubble) { const a = Math.min(1, (p.bubble.dur - p.bubble.t) * 2, p.bubble.t * 4); ctx.save(); ctx.globalAlpha = a; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.textAlign = 'center';
        const words = p.bubble.text.split(' '), l1 = words.slice(0, 4).join(' '), l2 = words.slice(4).join(' '), w = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + 28;
        ctx.fillStyle = 'rgba(255,255,255,0.94)'; rr(ctx, p.x - w / 2, p.y - 150, w, 66, 12); ctx.fill(); ctx.beginPath(); ctx.moveTo(p.x - 8, p.y - 84); ctx.lineTo(p.x + 8, p.y - 84); ctx.lineTo(p.x, p.y - 66); ctx.fill();
        ctx.fillStyle = '#3a2410'; ctx.fillText(l1, p.x, p.y - 124); ctx.fillText(l2, p.x, p.y - 98); ctx.restore(); } } },
    { y: b.y, f: () => drawBen(ctx, b.x, b.y, b.h, b.dir, b.phase, { moving: b.moving, bag: this.inv.carryingBag, carrot: s.feeding && s.feeding.t < 0.6 }) }];
  items.sort((a, c) => a.y - c.y).forEach(i => i.f());
  if (this.propFx && Assets.anim('props', 'sparkle')) { const f = this.propFx; f.t += 1 / 60; const an = Assets.anim('props', 'sparkle'); const i = Math.min(an.frames.length - 1, Math.floor(f.t / 0.22));
    if (f.t < 1.3) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; Assets.draw(ctx, 'props', an.frames[i], f.x, f.y, { h: 70 + i * 18, alpha: Math.min(1, (1.3 - f.t) * 3) }); ctx.restore(); } else this.propFx = null; }
  if (p.state === 'run' && p.t < 0.6) { ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', p.x, p.y - 55); }
}
function yardPrompt() {
  const s = this.sub; if (s.feeding) return null;
  if (s.nearPig) return `Feed a carrot (${this.inv.carrots} left)`;
  if (s.nearExit) return s.evening ? 'Go inside' : 'Out the gate';
  return null;
}
S.BACKYARD_MORNING = { enter() { yardEnter.call(this, false); Music.arm('town'); }, update: yardUpdate, draw: yardDraw, prompt: yardPrompt, exitFade: { fade: 0.9, style: 'cross' } };
S.BACKYARD_EVENING = { enter() { yardEnter.call(this, true); }, update: yardUpdate, draw: yardDraw, prompt: yardPrompt, exitFade: { fade: 0.6 } };

/* ---- Street (v3 near-top-down orthographic) ---- */
const streetCanStand = (x, y) => mapCanStand(Game.map, x, y);
function streetZoom() { return clamp(Math.max(this.H / 760, this.W / 1350), 0.45, 2.2) * CFG.streetZoom; }
// enter a district: M = STREET | TOWN | COAST, spawn point, facing, target marker, return-trip flag
function mapEnter(M, sp, dir, target, ret, label) {
  const b = this.ben; this.map = M;
  Object.assign(b, { x: sp[0], y: sp[1], asleep: false, h: CFG.benStreetHeight, dir, pose: 'idle', moving: false });
  const z = streetZoom.call(this); Object.assign(this.cam, { x: b.x, y: b.y, z });
  this.sub = { ret, target, rng: this.rngFor(label), slowT: 0, invuln: 0, carT: 1.5, seekers: 0, ingress: 0, carHits: 0, visited: new Set() };
  this.peds.clear(); this.cars.clear(); this.waves.clear(); b.pose = 'idle';
  this.pigF = this.inv.pigWithBen ? { x: b.x + 30, y: b.y + 26, t: 0, facing: 1, moving: false } : null;
  if (M === STREET || !this.sub.ret) this.say(Input.touchMode ? 'Tap a person or press FIRE to push them back' : 'Space / F or click a person to push them back', 3.5);
  const nPeds = M === COAST ? (ret ? 8 : 7) : ret ? 12 : 10; for (let i = 0; i < nPeds; i++) spawnPed.call(this, true);
  Audio.ambience({ street: M === COAST ? 0.2 : 0.35, morning: ret ? 0 : 0.2, evening: ret ? 0.2 : 0 }, 1.5);
}
const CALLOUTS = ['Hey King!', 'Gimme that crown!', 'Watch out, your douchiness!', 'Nice crown, your majesty!', 'Over here, King!', "That crown's mine!"];
const PED_KINDS = ['local', 'pareu', 'grocery', 'drifter', 'office', 'auntie', 'jogger', 'cyclist', 'officer'];
function spawnPed(initial) {
  const s = this.sub, r = s.rng, b = this.ben;
  let lane, t, x, y, tries = 0;
  let li;
  const M = this.map;
  do { li = Math.floor(r() * M.pedLanes.length); lane = M.pedLanes[li]; t = r(); x = lerp(lane.a[0], lane.b[0], t); y = lerp(lane.a[1], lane.b[1], t); tries++; }
  while (tries < 20 && dist(x, y, b.x, b.y) < (initial ? 350 : 700));
  const kind = s.ret ? PED_KINDS[Math.floor(r() * PED_KINDS.length)] : PED_KINDS[Math.floor(r() * 7)];
  const p = this.peds.get(); const dir = r() < 0.5 ? 1 : -1;
  const energetic = r() < (s.ret ? 0.45 : 0.3) && kind !== 'officer';
  Object.assign(p, { lane, li, mode: 'walk', alpha: 1, kt: 0, kvx: 0, kvy: 0, t, x, y, dir, kind, speed: kind === 'jogger' ? 120 : kind === 'cyclist' ? 170 : 55 + r() * 25, energetic, seek: 0, cool: 0, phase: r() * 3, vx: 0, vy: 0 });
}
function spawnCar() {
  const s = this.sub, r = s.rng, M = this.map; const lane = M.carLanes[Math.floor(r() * M.carLanes.length)];
  const kinds = s.ret ? ['truck', 'hatch', 'police'] : ['truck', 'hatch'];
  const c = this.cars.get(); const L = Math.hypot(lane.b[0] - lane.a[0], lane.b[1] - lane.a[1]);
  Object.assign(c, { heard: false, lane, d: 0, L, x: lane.a[0], y: lane.a[1], kind: kinds[Math.floor(r() * kinds.length)], speed: 190 + r() * 90,
    vx: (lane.b[0] - lane.a[0]) / L, vy: (lane.b[1] - lane.a[1]) / L });
}
function streetUpdate(dt, live) {
  const s = this.sub, b = this.ben, st = this.stats;
  const M = this.map, z = streetZoom.call(this); const vw = this.W / z, vh = this.H / z;
  const cx = vw >= M.w ? M.w / 2 : clamp(b.x, vw / 2, M.w - vw / 2), cy = vh >= M.h ? M.h / 2 : clamp(b.y, vh / 2, M.h - vh / 2);
  this.camTo(cx, cy, z, 6, dt);
  s.invuln = Math.max(0, s.invuln - dt); s.slowT = Math.max(0, s.slowT - dt);
  st.hunger = Math.min(100, st.hunger + dt * 0.35); st.fatigue = Math.min(100, st.fatigue + dt * 0.2);
  if (live && !s.locked) {
    const bar = s.barrierY || 0;
    this.moveBen(dt, CFG.benStreetSpeed * (s.slowT > 0 ? 0.6 : 1), bar ? (x, y) => y > bar && streetCanStand(x, y) : streetCanStand);
    if (bar && b.y < bar + 30 && b.moving && (s.barrierMsg || 0) <= 0) { s.barrierMsg = 3; this.say('Something is blocking the road north — clear them first'); }
    s.visited.add(`${Math.floor(b.y / 512) + 1}-${Math.floor(b.x / 512) + 1}`);
  } else b.moving = false;
  s.barrierMsg = Math.max(0, (s.barrierMsg || 0) - dt);
  streetCombat.call(this, dt, live);
  if (s.foes) beachFoes.call(this, dt, live);
  if (this.pigF) pigFollow.call(this, dt);
  // pedestrians + energetic ingress
  this.peds.each(p => {
    p.phase += dt;
    const near = dist(p.x, p.y, b.x, b.y);
    if (p.mode !== 'walk') { pedReaction.call(this, p, dt); if (near > 1900) { p.alive = false; spawnPed.call(this, false); } return; }
    if (p.energetic && p.cool <= 0 && near < 240 && p.seek <= 0) {
      p.seek = 4.5; s.seekers++; Audio.sfx('ingress');
      if ((s.calloutCd || 0) <= 0) { // they call out as they come at him
        const line = CALLOUTS[Math.floor(s.rng() * CALLOUTS.length)]; p.bubble = { text: line, t: 0 }; s.calloutCd = 2.6;
        const female = ['pareu', 'grocery', 'office', 'auntie', 'jogger'].includes(p.kind);
        Audio.say(line, { pitch: female ? 1.35 : 0.8, rate: 1.1 }); this.calloutLog = (this.calloutLog || []).concat([line]);
      }
    }
    if (p.bubble) { p.bubble.t += dt; if (p.bubble.t > 2.2) p.bubble = null; }
    p.cool = Math.max(0, p.cool - dt);
    if (p.seek > 0 && p.energetic) {
      p.seek -= dt; const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy) || 1;
      p.vx = dx / d * 150; p.vy = dy / d * 150; pedStep(p, p.vx * dt, p.vy * dt);
      if (d < 40 && s.invuln <= 0) {
        st.astral = Math.max(0, st.astral - CFG.ingressDrain); st.overload = Math.min(100, st.overload + CFG.ingressOverload);
        s.ingress++; s.invuln = 0.8; p.energetic = false; p.seek = 0; Audio.sfx('drain');
        this.spawnFx('wisp', b.x, b.y - 40, { h: 90, vy: -40, dur: 1 }); this.say('Energetic ingress — overload rising');
        if (st.overload >= 100) { s.slowT = 3; st.overload = 60; st.astral = Math.max(0, st.astral - 5); this.say('OVERLOADED — slowed'); }
      }
      if (p.seek <= 0) { p.cool = 6; // lose interest, drift back to lane
        const L = p.lane; const t = clamp(((p.x - L.a[0]) * (L.b[0] - L.a[0]) + (p.y - L.a[1]) * (L.b[1] - L.a[1])) / ((L.b[0] - L.a[0]) ** 2 + (L.b[1] - L.a[1]) ** 2), 0, 1); p.t = t; }
    } else {
      const L = p.lane, len = Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1]);
      p.t += p.dir * p.speed * dt / len; const tx = lerp(L.a[0], L.b[0], p.t), ty = lerp(L.a[1], L.b[1], p.t);
      p.vx = (tx - p.x) / Math.max(dt, 1e-3); p.vy = (ty - p.y) / Math.max(dt, 1e-3);
      p.x = lerp(p.x, tx, 1 - Math.exp(-5 * dt)); p.y = lerp(p.y, ty, 1 - Math.exp(-5 * dt));
      if (p.t < -0.02 || p.t > 1.02) { p.alive = false; spawnPed.call(this, false); }
    }
    if (near > 1900) { p.alive = false; spawnPed.call(this, false); }
  });
  // vehicles
  s.carT -= dt; if (s.carT <= 0 && this.cars.count() < (s.ret ? 6 : 5)) { spawnCar.call(this); s.carT = 1.2 + s.rng() * 2.2; }
  this.cars.each(c => {
    c.d += c.speed * dt; c.x = c.lane.a[0] + c.vx * c.d; c.y = c.lane.a[1] + c.vy * c.d;
    const cd = dist(c.x, c.y, b.x, b.y);
    if (!c.heard && cd < 620) { // approaching: chip engine pass-by, panned toward the car's side of the screen
      c.heard = true; const toward = ((b.x - c.x) * c.vx + (b.y - c.y) * c.vy) > 0;
      if (toward) { Audio.carPass(clamp((c.x - b.x) / 500, -1, 1) * (Math.abs(c.vx) > 0.5 ? 1 : 0.3), clamp(1.2 - cd / 700, 0.35, 1), c.kind); this.carSounds = (this.carSounds || 0) + 1; }
    }
    if (c.d > c.L) c.alive = false;
    const horiz = Math.abs(c.vx) > 0.5, hw = horiz ? 62 : 36, hh = horiz ? 30 : 58;
    if (s.invuln <= 0 && Math.abs(b.x - c.x) < hw && Math.abs(b.y - 8 - c.y) < hh) {
      st.health = Math.max(0, st.health - CFG.vehicleDamage); s.invuln = 1.4; s.carHits++; Audio.sfx('horn'); Audio.sfx('impact');
      const kx = horiz ? 0 : (b.x < c.x ? -1 : 1), ky = horiz ? (b.y < c.y ? -1 : 1) : 0;
      for (let i = 0; i < 12; i++) { const nx = b.x + kx * 6, ny = b.y + ky * 6; if (streetCanStand(nx, ny)) { b.x = nx; b.y = ny; } }
      b.pose = 'fall'; b.poseT = 0; this.say('Hit by a car!'); if (st.health <= 0) this.triggerGameOver('hit by traffic');
    }
  });
}
/* ---- street psychic push: Ben can fire back at people on the street ---- */
function streetFireAt(tx, ty) {
  const s = this.sub, b = this.ben, st = this.stats;
  if (s.fireCd > 0) { Audio.sfx('empty'); return false; }
  let lifeForce = false;
  if (st.astral < CFG.streetShotCost) {
    if (s.foes && s.foesLeft > 0 && st.health > 8) lifeForce = true; // the beach barrier can't soft-lock him: burn body instead
    else { Audio.sfx('empty'); this.say('No astral energy left'); return false; }
  }
  const hx = b.x, hy = b.y - b.h * 0.55; let a = Math.atan2(ty - hy, tx - hx);
  const w = this.waves.get(); Object.assign(w, { x: hx + Math.cos(a) * 20, y: hy + Math.sin(a) * 20, vx: Math.cos(a) * CFG.streetWaveSpeed, vy: Math.sin(a) * CFG.streetWaveSpeed, ang: a, trav: 0, age: 0 });
  if (lifeForce) { st.health -= 3; if ((s.lfMsg || 0) < 1) { s.lfMsg = 1; this.say('Out of astral — burning body energy'); } } else st.astral -= CFG.streetShotCost;
  s.fireCd = CFG.streetCooldown; s.shots = (s.shots || 0) + 1;
  b.dir = dirFromVec(Math.cos(a), Math.sin(a)); b.pose = 'cast'; b.poseT = 0.2; Audio.sfx('launch');
  return true;
}
function streetAutoTarget() { // nearest charged person first, then anyone close, else straight ahead
  const b = this.ben; let best = null, bd = 1e9;
  if (this.sub.foes) { let fb = null, fd = 760; this.sub.foes.forEach(f => { const d = dist(f.x, f.y, b.x, b.y); if (!f.dying && f.alpha > 0.3 && d < fd) { fd = d; fb = f; } });
    if (fb) return [fb.x + fb.vx * 0.2, fb.y + fb.vy * 0.2]; }
  this.peds.each(p => { if (p.mode !== 'walk') return; const d = dist(p.x, p.y, b.x, b.y) - (p.energetic ? 250 : 0); if (d < bd && dist(p.x, p.y, b.x, b.y) < 460) { bd = d; best = p; } });
  if (best) return [best.x + best.vx * 0.25, best.y - 34 + best.vy * 0.25];
  const a = b.dir * TAU / 8; return [b.x + Math.sin(a) * 300, b.y - b.h * 0.55 - Math.cos(a) * 300];
}
function streetCombat(dt, live) {
  const s = this.sub, b = this.ben;
  s.fireCd = Math.max(0, (s.fireCd || 0) - dt); s.calloutCd = Math.max(0, (s.calloutCd || 0) - dt);
  if (b.pose === 'cast' || b.pose === 'fall') { b.poseT = (b.poseT || 0) + dt; if (b.poseT > (b.pose === 'fall' ? 0.9 : 0.55)) b.pose = 'idle'; }
  if (live) {
    if (this.streetFire) { streetFireAt.call(this, this.streetFire.x, this.streetFire.y); this.streetFire = null; }
    else if (Input.pressed.has('Space') || Input.pressed.has('KeyF') || Input.fireTap) { const [tx, ty] = streetAutoTarget.call(this); streetFireAt.call(this, tx, ty); }
  }
  this.waves.each(w => {
    w.age += dt; w.x += w.vx * dt; w.y += w.vy * dt; w.trav += CFG.streetWaveSpeed * dt;
    if (w.trav > CFG.streetWaveRange) { w.alive = false; return; }
    this.peds.each(p => {
      if (!w.alive || p.mode !== 'walk') return;
      if (dist(w.x, w.y, p.x, p.y - 34) < 38) { w.alive = false; hitPed.call(this, p, w); }
    });
    if (w.alive && s.foes) for (const f of s.foes) { if (!f.dying && f.alpha > 0.3 && dist(w.x, w.y, f.x, f.y) < f.r) { w.alive = false; hitFoe.call(this, f, w); break; } }
  });
}
function pedStep(p, mx, my) { // people stay on streets/sidewalks (slide along edges)
  if (streetCanStand(p.x + mx, p.y + my)) { p.x += mx; p.y += my; } else if (streetCanStand(p.x + mx, p.y)) p.x += mx; else if (streetCanStand(p.x, p.y + my)) p.y += my;
}
function hitPed(p, w) {
  const s = this.sub, b = this.ben; if (p.mode !== 'walk') return;
  const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1;
  p.mode = 'knock'; p.kt = 0.45; p.kvx = dx / d * 420; p.kvy = dy / d * 420; p.seek = 0;
  const was = p.energetic; p.energetic = false;
  s.pushed = (s.pushed || 0) + 1; if (was) s.discharged = (s.discharged || 0) + 1;
  this.spawnFx('impact', p.x, p.y - 34, { h: 90, dur: 0.35 }); if (was) this.spawnFx('wisp', p.x, p.y - 40, { h: 80, vy: -50, dur: 1 });
  Audio.sfx('hit'); if (was) Audio.sfx('dissolve');
  // afterwards: half of them leave, half carry on along the far side of the street
  p.after = s.rng() < 0.5 ? 'flee' : 'cross';
}
function pedReaction(p, dt) {
  const b = this.ben;
  if (p.mode === 'knock') {
    pedStep(p, p.kvx * dt, p.kvy * dt); p.vx = p.kvx; p.vy = p.kvy;
    p.kvx *= Math.exp(-5 * dt); p.kvy *= Math.exp(-5 * dt); p.kt -= dt;
    if (p.kt <= 0) {
      if (p.after === 'cross') {
        const M = this.map, li = M.lanePair[p.li], L = M.pedLanes[li]; const horiz = L.a[1] === L.b[1];
        p.cross = horiz ? { x: clamp(p.x, 20, M.w - 20), y: L.a[1] } : { x: L.a[0], y: clamp(p.y, 20, M.h - 20) };
        p.newLi = li; p.mode = 'cross';
      } else { p.mode = 'flee'; p.fleeT = 0; }
    }
    return;
  }
  if (p.mode === 'flee') { // hurry away from Ben and fade out
    p.fleeT += dt; const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1;
    p.vx = dx / d * 140; p.vy = dy / d * 140; p.x += p.vx * dt; p.y += p.vy * dt; p.alpha = Math.max(0, 1 - p.fleeT / 1.8);
    if (p.fleeT > 1.8) { p.alive = false; spawnPed.call(this, false); }
    return;
  }
  if (p.mode === 'cross') { // cross to the other sidewalk, then keep walking there
    const dx = p.cross.x - p.x, dy = p.cross.y - p.y, d = Math.hypot(dx, dy);
    if (d < 6) {
      p.li = p.newLi; p.lane = this.map.pedLanes[p.li]; const L = p.lane;
      p.t = clamp(((p.x - L.a[0]) * (L.b[0] - L.a[0]) + (p.y - L.a[1]) * (L.b[1] - L.a[1])) / ((L.b[0] - L.a[0]) ** 2 + (L.b[1] - L.a[1]) ** 2), 0, 1);
      p.mode = 'walk'; p.cool = 8; return;
    }
    p.vx = dx / d * 120; p.vy = dy / d * 120; p.x += p.vx * dt; p.y += p.vy * dt;
  }
}
function streetDraw(ctx) {
  const b = this.ben, s = this.sub;
  const items = [];
  this.peds.each(p => items.push({ y: p.y, f: () => drawPed.call(this, ctx, p) }));
  this.cars.each(c => items.push({ y: c.y + 20, f: () => drawCar(ctx, c) }));
  if (this.pigF) { const q = this.pigF; items.push({ y: q.y, f: () => { if (q.guarding) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(q.x, q.y - 12, 2, q.x, q.y - 12, 34); g.addColorStop(0, 'rgba(255,220,120,0.5)'); g.addColorStop(1, 'rgba(255,200,80,0)'); ctx.fillStyle = g; ctx.fillRect(q.x - 34, q.y - 46, 68, 68); ctx.restore(); } drawGuineaPig(ctx, q.x, q.y, 34, q.moving ? 'run' : 'idle', q.t, q.facing, 0, q.guarding); } }); }
  if (s.foes) s.foes.forEach(f => items.push({ y: f.y + 34, f: () => f.person ? drawBarrierPerson(ctx, f) : drawLesser(ctx, f, this.time) }));
  items.push({ y: b.y, f: () => {
    ctx.save(); if (s.invuln > 0 && Math.floor(this.time * 12) % 2) ctx.globalAlpha = 0.5;
    drawBen(ctx, b.x, b.y, b.h, b.dir, b.phase, { moving: b.moving && b.pose !== 'fall', bag: this.inv.carryingBag && b.pose !== 'fall', pose: b.pose, poseT: b.poseT }); ctx.restore(); } });
  items.sort((a, c) => a.y - c.y).forEach(i => i.f());
  this.waves.each(w => { ctx.save(); ctx.globalCompositeOperation = 'lighter'; Assets.draw(ctx, 'vfx', Assets.animFrame('vfx', 'wave', w.age), w.x, w.y, { h: 80, rot: w.ang }); ctx.restore(); });
  if (s.barrierY) { // shimmering astral barrier across the north end
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const y0 = s.barrierY - 10;
    for (let i = 0; i < 3; i++) { ctx.strokeStyle = `rgba(160,110,255,${0.18 + 0.12 * Math.sin(this.time * 3 + i)})`; ctx.lineWidth = 6 - i * 2; ctx.beginPath();
      for (let x = 0; x <= this.map.w; x += 16) { const yy = y0 + Math.sin(x * 0.02 + this.time * 2 + i) * 6; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke(); }
    ctx.restore(); }
  // target markers
  const tgt = s.target; if (!tgt) return; const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
  ctx.save(); ctx.strokeStyle = `rgba(255,215,110,${0.5 + 0.4 * pulse})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(tgt[0], tgt[1], 36 + pulse * 6, 18 + pulse * 3, 0, 0, TAU); ctx.stroke(); ctx.restore();
}
function drawPed(ctx, p) {
  const side = Math.abs(p.vx) > Math.abs(p.vy);
  const an = p.kind + (side ? '_side' : '_front');
  const fr = Assets.animFrame('pedestrians', an, p.phase);
  if (p.energetic) {
    const g = ctx.createRadialGradient(p.x, p.y - 34, 4, p.x, p.y - 34, 58);
    g.addColorStop(0, `rgba(150,90,255,${p.seek > 0 ? 0.55 : 0.3})`); g.addColorStop(1, 'rgba(120,60,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 34, 58, 0, TAU); ctx.fill();
  }
  ctx.save(); ctx.globalAlpha = p.alpha ?? 1;
  shadow(ctx, p.x, p.y, 14);
  if (fr) Assets.draw(ctx, 'pedestrians', fr, p.x, p.y, { h: p.kind === 'cyclist' ? 74 : 64, flip: side && p.vx < 0 });
  ctx.restore();
  if (p.bubble) {
    const a = Math.min(1, (2.2 - p.bubble.t) * 3); ctx.save(); ctx.globalAlpha = a; ctx.font = 'bold 15px system-ui, sans-serif'; ctx.textAlign = 'center';
    const w = ctx.measureText(p.bubble.text).width + 16, bx = p.x, by = p.y - 96;
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; rr(ctx, bx - w / 2, by - 20, w, 26, 9); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx - 6, by + 6); ctx.lineTo(bx + 4, by + 6); ctx.lineTo(bx - 2, by + 16); ctx.fill();
    ctx.fillStyle = '#2a1840'; ctx.fillText(p.bubble.text, bx, by - 2); ctx.restore();
  }
  if (p.energetic && p.seek > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; Assets.draw(ctx, 'vfx', Assets.animFrame('vfx', 'wisp', p.phase), p.x + 18, p.y - 50, { h: 50, alpha: 0.8 }); ctx.restore(); }
}
function drawCar(ctx, c) {
  const horiz = Math.abs(c.vx) > 0.5; let view = horiz ? 'E' : (c.vy > 0 ? 'S' : 'N');
  const fr = Assets.animFrame('vehicles', c.kind + '_' + view, 0);
  ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(c.x, c.y + 22, horiz ? 64 : 40, horiz ? 22 : 34, 0, 0, TAU); ctx.fill(); ctx.restore();
  if (fr) Assets.draw(ctx, 'vehicles', fr, c.x, c.y, { h: horiz ? 88 : 104, flip: horiz && c.vx < 0 });
}
function streetPrompt() { return null; }

/* ---- coast barrier: four charged-up locals block the road into town; push each one back to pass ---- */
const BARRIER_KINDS = ['drifter', 'local', 'jogger', 'office'];
function spawnBeachFoes() {
  const s = this.sub, r = s.rng;
  s.foes = []; s.foesLeft = CFG.beachFoes;
  for (let i = 0; i < CFG.beachFoes; i++) {
    const sp = COAST.foeSpots[i % COAST.foeSpots.length];
    s.foes.push({ person: true, kind: BARRIER_KINDS[i % BARRIER_KINDS.length], hp: CFG.beachFoeHp, x: sp[0] + (r() - 0.5) * 40, y: sp[1] + (r() - 0.5) * 40, homeX: 0, homeY: 0,
      vx: 0, vy: 1, alpha: 0, hitT: 0, dying: false, dieT: 0, t: r() * 5, seed: i * 2.3, r: 38, wake: 0.5 + i * 0.9, active: false, phase: r() * 3 });
  }
  s.foes.forEach(f => { f.homeX = f.x; f.homeY = f.y; });
  s.barrierY = COAST.barrierY; Audio.sfx('ingress');
  this.say(`${CFG.beachFoes} charged-up people are blocking the road to town — push them back!`, 3); this.objective = 'CLEAR THE WAY NORTH';
}
function beachFoes(dt, live) {
  const s = this.sub, b = this.ben, st = this.stats, k = this.dayK();
  const hx = b.x, hy = b.y - 34;
  s.foes.forEach(f => {
    f.t += dt; f.phase += dt;
    if (f.dying) { // beaten: they back off down the road and fade
      f.dieT += dt; f.alpha = Math.max(0, 1 - f.dieT / 1.4); const d0 = Math.hypot(f.x - b.x, f.y - b.y) || 1; f.vx = (f.x - b.x) / d0 * 140; f.vy = (f.y - b.y) / d0 * 140; f.x += f.vx * dt; f.y += f.vy * dt; return; }
    f.alpha = Math.min(1, f.alpha + dt / 0.8);
    const dx = hx - f.x, dy = hy - f.y, d = Math.hypot(dx, dy) || 1;
    if (!f.active) { // loiter at their spot until Ben comes near
      f.x = f.homeX + Math.sin(f.t * 0.9 + f.seed) * 16; f.vx = Math.cos(f.t * 0.9 + f.seed) * 14; f.vy = 0.1;
      if (d < 720) { f.wake -= dt; if (f.wake <= 0) { f.active = true; Audio.sfx('ingress');
        if ((s.calloutCd || 0) <= 0) { const line = CALLOUTS[Math.floor(s.rng() * CALLOUTS.length)]; f.bubble = { text: line, t: 0 }; s.calloutCd = 2.4; Audio.say(line, { pitch: 0.85, rate: 1.1 }); } } }
      return;
    }
    if (f.bubble) { f.bubble.t += dt; if (f.bubble.t > 2.2) f.bubble = null; }
    if (f.hitT > 0) { f.hitT -= dt; f.x -= dx / d * 260 * dt; f.y -= dy / d * 260 * dt; f.vx = -dx; f.vy = -dy; return; }
    const sp = CFG.beachFoeSpeed * k; f.vx = dx / d * sp; f.vy = dy / d * sp; f.x += f.vx * dt; f.y += f.vy * dt;
    if (d < 40 && s.invuln <= 0) { // they grab at him
      st.astral = Math.max(0, st.astral - CFG.beachContactDrain); st.health = Math.max(0, st.health - CFG.beachContactHurt);
      s.invuln = 1.0; f.hitT = 0.6; b.pose = 'fall'; b.poseT = 0.3; Audio.sfx('drain'); this.spawnFx('bubble', hx, hy, { h: 120, dur: 0.5 });
      this.say('One of them got a hand on him!'); s.foeContacts = (s.foeContacts || 0) + 1;
      if (st.health <= 0) this.triggerGameOver('mobbed on the coast road');
    }
  });
  if (s.foesLeft <= 0 && s.barrierY && s.foes.every(f => f.dieT > 1.2)) {
    s.barrierY = 0; s.cleared = true; Audio.sfx('victory'); this.say('They scatter. The way to town is clear', 2.5); this.objective = 'HEAD NORTH INTO TOWN';
  }
}
function drawBarrierPerson(ctx, f) {
  const side = Math.abs(f.vx) > Math.abs(f.vy), fr = Assets.animFrame('pedestrians', f.kind + (side ? '_side' : '_front'), f.phase);
  if (!f.dying) { const g = ctx.createRadialGradient(f.x, f.y, 4, f.x, f.y, 60); g.addColorStop(0, `rgba(170,90,255,${f.active ? 0.55 : 0.3})`); g.addColorStop(1, 'rgba(120,60,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, 60, 0, TAU); ctx.fill(); }
  ctx.save(); ctx.globalAlpha = f.alpha; shadow(ctx, f.x, f.y + 34, 14); if (f.hitT > 0) ctx.translate((Math.random() - 0.5) * 6, 0);
  if (fr) Assets.draw(ctx, 'pedestrians', fr, f.x, f.y + 34, { h: 66, flip: side && f.vx < 0 }); ctx.restore();
  if (!f.dying) for (let i = 0; i < CFG.beachFoeHp; i++) { ctx.fillStyle = i < f.hp ? '#c9a0ff' : 'rgba(255,255,255,0.2)'; ctx.fillRect(f.x - CFG.beachFoeHp * 7 + i * 14, f.y - 52, 10, 4); }
  if (f.bubble) { const a = Math.min(1, (2.2 - f.bubble.t) * 3); ctx.save(); ctx.globalAlpha = a; ctx.font = 'bold 15px system-ui, sans-serif'; ctx.textAlign = 'center'; const w = ctx.measureText(f.bubble.text).width + 16; ctx.fillStyle = 'rgba(255,255,255,0.92)'; rr(ctx, f.x - w / 2, f.y - 82, w, 26, 9); ctx.fill(); ctx.fillStyle = '#2a1840'; ctx.fillText(f.bubble.text, f.x, f.y - 64); ctx.restore(); }
}
function hitFoe(f, w) {
  const s = this.sub; if (f.dying) return; f.hp--; f.hitT = 0.5; f.active = true; Audio.sfx('hit'); this.spawnFx('impact', f.x, f.y, { h: 90, dur: 0.35 });
  if (f.hp <= 0) { f.dying = true; f.dieT = 0; f.bubble = null; s.foesLeft--; Audio.sfx('dissolve'); this.stats.astral = Math.min(100, this.stats.astral + CFG.killRestore);
    this.spawnFx('wisp', f.x, f.y - 10, { h: 80, vy: -50, dur: 1.0 }); this.beachKills = (this.beachKills || 0) + 1; }
}
/* the little guinea pig friend trots after Ben on the maps (from day 2) */
// a carrot fuels CFG.pigAttacksPerCarrot attacks; the pig eats one automatically when it needs to fight
function pigFuel(q) {
  const inv = this.inv; if (inv.pigCharges > 0) return true;
  if (inv.carrots > 0) { inv.carrots--; inv.pigCharges = CFG.pigAttacksPerCarrot; Audio.sfx('munch'); this.sparkle(q.x, q.y - 20, 10, [255, 170, 90]); this.say(`Carrot! The guinea pig is ready to fight (×${CFG.pigAttacksPerCarrot})`, 2); return true; }
  if (!q.hungryT || this.time - q.hungryT > 6) { q.hungryT = this.time; this.say('The guinea pig needs a carrot to fight', 1.8); }
  return false;
}
function pigFollow(dt) {
  const q = this.pigF, b = this.ben, s = this.sub; q.t += dt; q.cool = Math.max(0, (q.cool || 0) - dt);
  // guardian: when a charged person or a shade comes within reach, the guinea pig circles Ben fast and knocks them back
  let threat = null, td = CFG.pigGuardRange;
  this.peds.each(p => { if (p.mode === 'walk' && p.energetic) { const d = dist(p.x, p.y, b.x, b.y); if (d < td) { td = d; threat = { x: p.x, y: p.y - 20, hit: () => hitPed.call(this, p, null), r: 40 }; } } });
  if (s.foes) s.foes.forEach(f => { if (!f.dying && f.active && f.alpha > 0.3) { const d = dist(f.x, f.y, b.x, b.y); if (d < td) { td = d; threat = { x: f.x, y: f.y, hit: () => hitFoe.call(this, f, null), r: f.r + 10 }; } } });
  if (threat && !pigFuel.call(this, q)) threat = null; // no carrot, no attack: the pig just keeps close
  if (threat) {
    q.orbit = (q.orbit || 0) + dt * CFG.pigOrbitSpeed; q.moving = true; q.guarding = true;
    // orbit that bulges toward the threat so the circle clips them
    const ang = Math.atan2(threat.y - b.y, threat.x - b.x), rel = q.orbit - ang, R = CFG.pigOrbitRadius + Math.max(0, Math.cos(rel)) * Math.max(0, Math.min(td - 20, 90));
    const nx = b.x + Math.cos(q.orbit) * R, ny = b.y + Math.sin(q.orbit) * R * 0.7;
    q.facing = nx > q.x ? 1 : -1; q.x = nx; q.y = ny;
    if (q.cool <= 0 && dist(q.x, q.y, threat.x, threat.y) < threat.r) { q.cool = 1.1; threat.hit(); this.inv.pigCharges--; this.sparkle(q.x, q.y - 20, 14, [255, 220, 120]); Audio.sfx('squeak'); this.pigHits = (this.pigHits || 0) + 1; if ((s.pigMsg || 0) <= 0) { s.pigMsg = 6; this.say(`The guinea pig goes for them! (${this.inv.pigCharges} left on this carrot)`, 1.8); } }
    s.pigMsg = Math.max(0, (s.pigMsg || 0) - dt); return;
  }
  q.guarding = false;
  const a = b.dir * TAU / 8, tx = b.x - Math.sin(a) * 34 + 14, ty = b.y + Math.cos(a) * 34 + 6;
  const dx = tx - q.x, dy = ty - q.y, d = Math.hypot(dx, dy);
  if (d > 420) { q.x = tx; q.y = ty; q.moving = false; return; }
  if (d > 10) { const sp = Math.min(d, Math.max(CFG.benStreetSpeed * 1.2, d * 3) * dt); q.x += dx / d * sp; q.y += dy / d * sp; q.moving = true; if (Math.abs(dx) > 2) q.facing = dx > 0 ? 1 : -1; }
  else { q.moving = false; q.facing = b.x > q.x ? 1 : -1; }
}

S.BEACH_OUTBOUND = { // coastal map: south end of the footpath -> lower avenue -> east edge (barrier wave on the way)
  enter() { mapEnter.call(this, COAST, COAST.southSpawn, 0, COAST.northOut, false, 'beach-out'); this.objective = 'FOLLOW THE COAST PATH NORTH INTO TOWN'; },
  update(dt, live) {
    const s = this.sub, b = this.ben;
    if (!s.foes && b.y < COAST.waveTrigger) spawnBeachFoes.call(this);
    streetUpdate.call(this, dt, live);
    if (live && s.cleared && b.y < COAST.northOut[1] + 10) this.complete();
  },
  draw: streetDraw, prompt: streetPrompt, exitFade: { fade: 0.6 },
  debugSkip() { const s = this.sub; if (!s.foes) spawnBeachFoes.call(this); s.foes.forEach(f => { if (!f.dying) { f.dying = true; f.dieT = 1.3; s.foesLeft--; } }); this.ben.x = COAST.northOut[0]; this.ben.y = COAST.northOut[1] - 2; },
};
S.TOWN_OUTBOUND = { // residential grid: west edge on the lower avenue -> north up the first through street
  enter() { mapEnter.call(this, TOWN, TOWN.southSpawn, 0, TOWN.northOut, false, 'town-out'); this.objective = 'THROUGH TOWN TO THE SAFEWAY DISTRICT'; },
  update(dt, live) { streetUpdate.call(this, dt, live); if (live && this.ben.y < TOWN.northOut[1] + 12) this.complete(); },
  draw: streetDraw, prompt: streetPrompt, exitFade: { fade: 0.5 },
  debugSkip() { this.ben.x = TOWN.northOut[0]; this.ben.y = TOWN.northOut[1] - 2; },
};
S.STREET_OUTBOUND = {
  enter() { mapEnter.call(this, STREET, STREET.homeSpawn, 0, STREET.safeway, false, 'outbound'); this.objective = 'GET FOOD FROM SAFEWAY'; },
  update(dt, live) {
    streetUpdate.call(this, dt, live);
    if (live && dist(this.ben.x, this.ben.y, STREET.safeway[0], STREET.safeway[1]) < 55) this.complete();
  },
  draw: streetDraw, prompt: streetPrompt, exitFade: { fade: 0.45 },
  debugSkip() { this.ben.x = STREET.safeway[0]; this.ben.y = STREET.safeway[1] + 20; },
};
S.SAFEWAY = { // entering is a trigger: fade, purchase, respawn outside with the bag
  enter() {
    const s = this.stats; const b = this.ben;
    this.sub = { t: 0, done: false };
    Object.assign(b, { x: STREET.safewaySpawn[0], y: STREET.safewaySpawn[1], dir: 4, moving: false });
    if (this.pigF) Object.assign(this.pigF, { x: b.x + 30, y: b.y + 20, moving: false });
    this.cam.x = clamp(b.x, 0, STREET.w); this.cam.y = b.y;
    Audio.sfx('purchase');
    const cost = Math.min(CFG.groceryCost, s.money); s.money -= cost;
    this.inv.groceries = true; this.inv.carryingBag = true; this.inv.carrots += CFG.carrotsFromGroceries;
    this.purchaseLog = (this.purchaseLog || []).concat([{ cost, moneyAfter: s.money }]);
    this.say(`Groceries: −$${cost}  ·  +${CFG.carrotsFromGroceries} carrots`, 2.6);
    this.objective = 'GET HOME';
  },
  update(dt) {
    this.sub.t += dt; this.peds.each(p => { p.phase += dt; });
    if (this.sub.t > 0.9) this.complete();
  },
  draw(ctx) { const b = this.ben, q = this.pigF; if (q) drawGuineaPig(ctx, q.x, q.y, 34, 'idle', 0, -1); drawBen(ctx, b.x, b.y, b.h, b.dir, 0, { bag: true }); },
  exitFade: { fade: 0 },
};
S.STREET_RETURN = {
  enter() { mapEnter.call(this, STREET, STREET.safewaySpawn, 4, STREET.home, true, 'return'); this.objective = 'GET HOME — OUT BY THE SOUTH STREET'; },
  update(dt, live) {
    streetUpdate.call(this, dt, live);
    if (live && this.ben.y > STREET.home[1] - 32) this.complete();
  },
  draw: streetDraw, prompt: streetPrompt, exitFade: { fade: 0.6 },
  debugSkip() { this.ben.x = STREET.home[0]; this.ben.y = STREET.home[1]; },
};
S.TOWN_RETURN = {
  enter() { mapEnter.call(this, TOWN, TOWN.northSpawn, 4, TOWN.southIn, true, 'town-ret'); this.objective = 'GET HOME — BACK THROUGH TOWN'; },
  update(dt, live) { streetUpdate.call(this, dt, live); if (live && this.ben.y > TOWN.southIn[1] - 24) this.complete(); },
  draw: streetDraw, prompt: streetPrompt, exitFade: { fade: 0.5 },
  debugSkip() { this.ben.x = TOWN.southIn[0]; this.ben.y = TOWN.southIn[1] + 2; },
};
S.BEACH_RETURN = {
  enter() { Music.arm('town'); mapEnter.call(this, COAST, COAST.northSpawn, 4, COAST.south, true, 'beach-ret'); this.objective = 'GET HOME — ALONG THE COAST PATH'; },
  update(dt, live) { streetUpdate.call(this, dt, live); if (live && this.ben.y > COAST.south[1] - 24) this.complete(); },
  draw: streetDraw, prompt: streetPrompt, exitFade: { fade: 0.9, style: 'cross' },
  debugSkip() { this.ben.x = COAST.south[0]; this.ben.y = COAST.south[1] + 4; },
};

/* ---- ROOM_EATING: groceries away, ice cream on the bed, tub aside ---- */
S.ROOM_EATING = {
  enter() {
    Object.assign(this.room, { plate: 'day', mix: 0, void: 1, outer: [14, 8, 6], evening: 1 });
    Object.assign(this.ben, { x: ROOM.door[0] + 30, y: ROOM.door[1] - 10, asleep: false, h: CFG.benRoomHeight, dir: 1, pose: 'idle', moving: false });
    this.roomCam(0, true);
    this.sub = { step: 'toDesk', t: 0, tub: -1, spoon: -1 }; this.objective = 'Evening';
    Audio.ambience({ evening: 0.4, room: 0.35 }, 1.5);
  },
  update(dt) {
    const s = this.sub, b = this.ben; s.t += dt;
    this.roomCam(dt);
    switch (s.step) {
      case 'toDesk': if (this.walkTo(ROOM.desk[0], ROOM.desk[1], 260, dt)) { s.step = 'putAway'; s.t = 0; b.dir = 1; Audio.sfx('bag'); } break;
      case 'putAway': if (s.t > 1.2) { this.inv.carryingBag = false; this.inv.groceriesStored = true; this.say('Groceries put away'); s.step = 'toBed'; s.t = 0; } break;
      case 'toBed': if (this.walkTo(ROOM.sit[0], ROOM.sit[1], 260, dt)) { s.step = 'sit'; s.t = 0; b.dir = 4; b.pose = 'sit'; s.tub = 0; } break;
      case 'sit': if (s.t > 0.8) { s.step = 'open'; s.t = 0; s.tub = 1; Audio.sfx('lid'); } break;
      case 'open': // spoonfuls: full -> half -> empty
        s.spoon = (s.t % 0.9) / 0.9; if (s.t % 0.9 < dt) Audio.sfx('spoon');
        if (s.t > 2.7 && s.tub === 1) s.tub = 2;
        if (s.t > 5.4) { s.tub = 3; s.spoon = -1; s.step = 'aside'; s.t = 0;
          this.stats.hunger = Math.max(0, this.stats.hunger - CFG.iceCreamHungerRelief); this.inv.groceries = false; }
        break;
      case 'aside': if (s.t > 1.0) { s.step = 'done'; s.t = 0; s.tubAside = true; b.pose = 'idle'; b.x += 40; this.complete(); } break;
    }
  },
  draw(ctx) {
    const s = this.sub, b = this.ben; drawRoomActors.call(this, ctx);
    if (s.tub >= 0 && !s.tubAside) drawIceCream(ctx, b.x + (b.dir === 4 ? -30 : 0), b.y - b.h * 0.33, 56, s.tub, s.spoon);
  },
  exitFade: { fade: 0 },
};

/* ---- BED: player-triggered sleep, room fades toward night ---- */
S.BED = {
  enter() { this.sub = { phase: 'free', t: 0 }; this.objective = 'Go to bed'; this.room.evening = 1; },
  update(dt, live) {
    const s = this.sub, b = this.ben; s.t += dt;
    this.roomCam(dt);
    if (s.phase === 'free') {
      if (!live) return;
      this.moveBen(dt, CFG.benRoomSpeed, benRoomCanStand);
      s.nearBed = dist(b.x, b.y, ROOM.bedZone[0], ROOM.bedZone[1]) < 170;
      if (s.nearBed && Input.action()) { s.phase = 'getIn'; s.t = 0; Audio.sfx('sleep'); b.asleep = true; b.x = ROOM.sleep[0]; b.y = ROOM.sleep[1]; this.benLine('The nights are the hardest.', 0.4, 4.2, true); }
    } else {
      // fade the room toward night: day -> astral-night plate, lights down
      const k = clamp(s.t / 4.2, 0, 1); this.room.mix = ease(k); this.room.evening = 1 - k;
      Audio.ambience({ room: 0.5, evening: 0.2 * (1 - k) }, 0.5);
      this.camTo(ROOM.closeCam[0], ROOM.closeCam[1], this.roomFitZoom() * lerp(1.08, 2.3, ease(k)), 1.5, dt);
      if (k >= 1) { if (this.day >= CFG.lastDay) { this.go('DREAM', { fade: 1.4, style: 'cross' }); return; } this.day++; this.complete(); }
    }
  },
  draw(ctx) {
    drawRoomActors.call(this, ctx);
    drawIceCream(ctx, ROOM.nightstand[0], ROOM.nightstand[1], 40, 3);
  },
  prompt() { return this.sub.phase === 'free' && this.sub.nearBed ? 'Sleep' : null; },
  exitFade: { fade: 0 },
};

/* ---- DREAM (the last night of Act 1, no fight): the guinea pig takes Ben on a spirit journey ---- */
S.DREAM = {
  enter() {
    Object.assign(this.ben, { x: ROOM.sleep[0], y: ROOM.sleep[1], asleep: true, pose: 'idle', moving: false, h: CFG.benRoomHeight });
    Object.assign(this.room, { plate: 'night', mix: 0, void: 1 });
    this.waves.clear(); this.pulses.clear(); this.combat = null; this.objective = '';
    Audio.ambience({ astral: 0.25, room: 0.1 }, 3); Audio.sfx('tonal');
    this.center = { text: 'He dreams…', t: 0, dur: 3.2 };
    // the guinea pig is the guide into the dream world
    this.sub = { pig: { x: ROOM.sleep[0] + 210, y: ROOM.sleep[1] + 150, t: 0, facing: -1 }, said: 0 };
  },
  update(dt) {
    const k = clamp(this.stateT / 6, 0, 1);
    this.room.outer = [Math.round(lerp(0, 60, k)), Math.round(lerp(0, 40, k)), Math.round(lerp(0, 90, k))];
    this.room.void = 1 - 0.4 * Math.sin(k * Math.PI);
    this.camTo(ROOM.closeCam[0], ROOM.closeCam[1], this.roomFitZoom() * lerp(1.4, 2.6, ease(k)), 1.2, dt);
    if (Math.random() < dt * 6) { const p = this.parts.get(), a = Math.random() * TAU, r = 200 + Math.random() * 500;
      Object.assign(p, { x: ROOM.sleep[0] + Math.cos(a) * r, y: ROOM.sleep[1] + Math.sin(a) * r * 0.6, vx: 0, vy: -30 - Math.random() * 40, g: 0, t: 0, life: 2.5, size: 3 + Math.random() * 5, col: Math.random() < 0.5 ? [255, 215, 140] : [150, 220, 255] }); }
    const pg = this.sub.pig; pg.t += dt; pg.x = ROOM.sleep[0] + 210 + Math.sin(this.stateT * 0.8) * 30; pg.y = ROOM.sleep[1] + 150 - Math.abs(Math.sin(this.stateT * 3)) * 6;
    if (this.stateT > 3.4 && !this.sub.said) { this.sub.said = 1; this.center = { text: '"Let me take you on a spirit journey."', t: 0, dur: 4.6 }; Audio.say('Let me take you on a spirit journey.', { pitch: 1.6, rate: 1.0 }); Audio.sfx('sparkle'); this.sparkle(pg.x, pg.y - 30, 40); }
    if (this.stateT > 5 && Math.random() < dt * 3) this.sparkle(pg.x + (Math.random() - 0.5) * 60, pg.y - 20, 3);
    if (this.stateT > 9) this.complete();
  },
  draw(ctx) { drawRoomActors.call(this, ctx); const pg = this.sub.pig; if (this.stateT > 2.2) { ctx.save(); ctx.globalAlpha = clamp((this.stateT - 2.2) / 1.2, 0, 1); drawGuineaPig(ctx, pg.x, pg.y, 70, 'idle', pg.t, pg.facing, 0, this.stateT > 3.4); ctx.restore(); } },
  exitFade: { fade: 1.6 },
};
/* ---- ACT_END: end of Act 1 ---- */
S.ACT_END = {
  enter() {
    this.sub = { spoke: 0 }; this.objective = ''; this.peds.clear(); this.cars.clear(); this.parts.clear(); this.fx.clear();
    Audio.ambience({ astral: 0.12 }, 2); this.endings = (this.endings || 0) + 1;
  },
  lines: [[0.8, 5.2, "It wasn't always like this…"], [5.8, 1e9, 'ACT 2: KALALAU'], [8.4, 1e9, 'TO BE CONTINUED']],
  update(dt, live) {
    const t = this.stateT, s = this.sub;
    if (s.spoke === 0 && t > 0.9) { s.spoke = 1; Audio.say("It wasn't always like this.", { pitch: 0.7, rate: 0.8 }); }
    if (s.spoke === 1 && t > 5.9) { s.spoke = 2; Audio.sfx('victory'); }
    if (live && t > 10 && (Input.action() || Input.fire() || Input.pointer.tapQueue.length)) { this.center = null; this.startKalalau(); }
  },
  draw(ctx) {
    const G = this, t = G.stateT, W = G.W, H = G.H; ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const sp = G.splash;
    if (sp && sp.complete && sp.naturalWidth && t > 5.4) { // the key art drifts up behind the act card
      // only Ben's half of the key art (the painted title stays out of frame so the act card reads cleanly)
      const sw = sp.naturalWidth * 0.5, sh = sp.naturalHeight, a = clamp((t - 5.4) / 3, 0, 1) * 0.4, k = Math.max(H / sh, W / (sw * 2)) * (1.02 + 0.01 * Math.min(t - 5.4, 10));
      ctx.globalAlpha = a; ctx.drawImage(sp, 0, 0, sw, sh, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
    }
    ctx.textAlign = 'center';
    const L = S.ACT_END.lines;
    { const [a, b, txt] = L[0], al = clamp(Math.min((t - a) / 1.2, (b - t) / 1.0), 0, 1);
      if (al > 0) { ctx.globalAlpha = al; ctx.fillStyle = '#e6e2d6'; ctx.font = `italic ${Math.min(30, W / 20)}px Georgia, serif`; ctx.fillText(txt, W / 2, H / 2); } }
    { const al = clamp((t - L[1][0]) / 1.5, 0, 1);
      if (al > 0) { ctx.globalAlpha = al; ctx.fillStyle = '#ffd98a'; ctx.shadowColor = '#e0a030'; ctx.shadowBlur = 24; ctx.font = `600 ${Math.min(54, W / 14)}px Georgia, serif`; ctx.fillText("ACT 2: KALALAU", W / 2, H * 0.46); ctx.shadowBlur = 0; } }
    { const al = clamp((t - L[2][0]) / 1.5, 0, 1);
      if (al > 0) { ctx.globalAlpha = al; ctx.fillStyle = '#d8d4c8'; ctx.font = `600 ${Math.min(20, W / 26)}px Georgia, serif`; ctx.fillText('T O   B E   C O N T I N U E D', W / 2, H * 0.46 + Math.min(54, W / 14)); } }
    if (t > 10) { ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 2); ctx.fillStyle = '#9aa3b8'; ctx.font = '13px system-ui, sans-serif'; ctx.fillText(Input.touchMode ? 'Tap to begin Act 2' : 'Click or press Enter to begin Act 2', W / 2, H - 30); }
    ctx.globalAlpha = 1;
  },
};

/* ================================================================== UI */
const UI = {
  actionButton() { const G = Game; return { x: G.W - 64, y: G.H - 70, r: 38 }; },
  fireButton() { const G = Game; return (G.mode === 'street' && G.state !== 'SAFEWAY') || (G.mode === 'kal' && ((Kal.kama && Kal.kama.mode === 'combat') || Kal.phase === 'FIGHT' || (Kal.marchers && Kal.marchers.warned && !Kal.marchers.veer))) ? { x: G.W - 150, y: G.H - 60, r: 32 } : null; },
  bar(ctx, x, y, w, v, col, label) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; rr(ctx, x, y, w, 7, 3.5); ctx.fill();
    ctx.fillStyle = col; rr(ctx, x, y, Math.max(0, w * clamp(v / 100, 0, 1)), 7, 3.5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(label, x + w + 6, y + 7);
  },
  draw(ctx) {
    const G = Game, st = G.stats; if (!st) return;
    const battle = G.state === 'LESSER_ENTITIES' || G.state === 'DEMON_BATTLE';
    const quiet = ['NIGHT_CLOSE', 'ASTRAL_REVEAL', 'DAWN', 'DREAM', 'ACT_END'].includes(G.state);
    ctx.save();
    if (!quiet) {
      // restrained stat strip (top-left)
      const x = 14, y = 14, w = battle ? 70 : 60; ctx.globalAlpha = battle ? 0.55 : 0.8;
      this.bar(ctx, x, y, w, st.health, '#d9665b', 'body');
      this.bar(ctx, x, y + 13, w, st.astral, '#e8c15c', 'astral');
      this.bar(ctx, x, y + 26, w, st.overload, '#a07cff', 'overload');
      if (!battle) {
        this.bar(ctx, x, y + 39, w, st.hunger, '#c98a4a', 'hunger'); this.bar(ctx, x, y + 52, w, st.fatigue, '#7b95b8', 'fatigue');
        ctx.fillStyle = '#f1e6c8'; ctx.font = '12px system-ui, sans-serif';
        const kalPig = G.mode === 'kal' && Kal.pig, pig = G.inv.pigWithBen || kalPig ? `  ·  🐹 ${G.inv.pigCharges || 0}/${CFG.pigAttacksPerCarrot}` : '';
        if (G.mode !== 'kal' || kalPig) ctx.fillText(G.mode === 'kal' ? `🥕 ${G.inv.carrots}${pig}` : `$${st.money}  ·  🥕 ${G.inv.carrots}${pig}${G.inv.carryingBag ? '  ·  🛍' : ''}  ·  Day ${G.day}`, x, y + 80);
      }
      ctx.globalAlpha = 1;
      if (G.objective && !battle) { ctx.textAlign = 'center'; ctx.font = '600 14px system-ui, sans-serif'; ctx.fillStyle = 'rgba(0,0,0,0.45)';
        const tw = ctx.measureText(G.objective).width + 24; rr(ctx, G.W / 2 - tw / 2, 10, tw, 26, 13); ctx.fill(); ctx.fillStyle = '#ffe7a6'; ctx.fillText(G.objective, G.W / 2, 28); }
    }
    if (battle) this.battleHud(ctx);
    if (G.mode === 'street' && G.map) this.streetHud(ctx);
    if (G.mode === 'yard' && G.sub && !G.sub.feeding) { const tgt = (G.sub.fed || G.inv.carrots <= 0) ? (G.sub.evening ? YARD.door : YARD.gate) : null; if (tgt) this.edgeArrow(ctx, tgt); }
    // interaction prompt
    const pf = S[G.state].prompt; const p = pf && !G.trans && pf.call(G);
    if (p) { ctx.textAlign = 'center'; ctx.font = '600 15px system-ui, sans-serif'; const t = (Input.touchMode ? 'Tap: ' : '[E] or click: ') + p; const tw = ctx.measureText(t).width + 28;
      ctx.fillStyle = 'rgba(20,14,6,0.7)'; rr(ctx, G.W / 2 - tw / 2, G.H - 96, tw, 32, 16); ctx.fill(); ctx.strokeStyle = 'rgba(255,215,120,0.6)'; ctx.stroke(); ctx.fillStyle = '#ffe7a6'; ctx.fillText(t, G.W / 2, G.H - 75); }
    if (G.toast) { const a = Math.min(1, (G.toast.dur - G.toast.t) * 2, G.toast.t * 5); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.font = '13px system-ui, sans-serif'; ctx.fillStyle = '#fff4d6'; ctx.fillText(G.toast.text, G.W / 2, G.H * 0.22); ctx.globalAlpha = 1; }
    if (G.line) { const L = G.line;
      if (L.t >= 0 && !L.spoken) { L.spoken = true; Audio.say(L.text, { pitch: 0.75, rate: 0.92 }); }
      if (L.t >= 0) { const a = clamp(Math.min(L.t / 0.6, (L.dur - L.t) / 0.8), 0, 1); ctx.globalAlpha = a; ctx.textAlign = 'center';
        // size to the screen, wrapping onto extra lines on narrow (portrait) screens instead of shrinking
        const fs = L.big ? clamp(G.W / 16, 26, 40) : clamp(G.W / 34, 19, 22), maxW = G.W - 56; ctx.font = `italic ${fs}px Georgia, serif`;
        const lines = []; let cur = ''; for (const w of L.text.split(' ')) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW - 24 && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur);
        const lh = fs * 1.3, bw = Math.min(maxW, Math.max(...lines.map(l => ctx.measureText(l).width)) + 36), bh = lines.length * lh + fs * 0.7;
        const cy = L.big ? G.H * 0.6 : G.H * (G.W < G.H ? 0.66 : 0.72), y0 = cy - bh / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; rr(ctx, G.W / 2 - bw / 2, y0, bw, bh, 12); ctx.fill();
        ctx.fillStyle = '#f3ead2'; lines.forEach((l, i) => ctx.fillText(l, G.W / 2, y0 + fs * 0.35 + (i + 0.8) * lh)); ctx.globalAlpha = 1; }
      if (L.t > L.dur) G.line = null; }
    if (G.center) { const c = G.center; const a = Math.min(1, c.t / 0.8, (c.dur - c.t) / 0.6);
      if (a > 0) { ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe6a0'; ctx.shadowColor = '#e0a030'; ctx.shadowBlur = 18; const fs = clamp(G.W / 16, 22, 34); ctx.font = `600 ${fs}px Georgia, serif`;
        const lines = []; let cur = ''; for (const w of c.text.split(' ')) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > G.W - 48 && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur);
        lines.forEach((l, i) => ctx.fillText(l, G.W / 2, G.H / 2 + (i - (lines.length - 1) / 2) * fs * 1.25)); ctx.shadowBlur = 0; ctx.globalAlpha = 1; }
      if (c.t > c.dur) G.center = null; }
    this.standinTag(ctx);
    this.touch(ctx);
    ctx.restore();
  },
  offscreenPointer(ctx, wx, wy, col) { // arrow on the screen edge toward something outside the view
    const G = Game, [sx, sy] = G.worldToScreen(wx, wy), m = 26;
    if (sx > m && sy > m && sx < G.W - m && sy < G.H - m) return;
    const cx = G.W / 2, cy = G.H / 2, a = Math.atan2(sy - cy, sx - cx);
    const k = Math.min((G.W / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (G.H / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
    const ex = cx + Math.cos(a) * k, ey = cy + Math.sin(a) * k, p = 0.6 + 0.4 * Math.sin(G.time * 8);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(a); ctx.globalAlpha = p; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-5, 0); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill(); ctx.restore();
  },
  battleHud(ctx) {
    { const G = Game;
      if (G.state === 'LESSER_ENTITIES' && G.sub.cur && !G.sub.cur.dying && G.sub.cur.alpha > 0.2) this.offscreenPointer(ctx, G.sub.cur.x, G.sub.cur.y, '#b58cff');
      if (G.state === 'DEMON_BATTLE' && G.sub.d && !['dying', 'gone'].includes(G.sub.d.mode)) this.offscreenPointer(ctx, G.sub.d.x, G.sub.d.y, G.sub.d.flare > 0.3 ? '#ff7a3a' : '#ff4f8a');
      G.pulses.each(pl => this.offscreenPointer(ctx, pl.x, pl.y, 'rgba(140,200,255,0.9)')); }
    const G = Game, b = G.ben; const [sx, sy] = G.worldToScreen(b.x, b.y - b.h * 0.5); const R = Math.max(34, b.h * G.cam.z * 0.62);
    // astral defence ring + cooldown arc around Ben
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.stroke();
    ctx.strokeStyle = G.stats.astral > 25 ? 'rgba(240,196,92,0.9)' : 'rgba(255,110,80,0.95)'; ctx.beginPath(); ctx.arc(sx, sy, R, -Math.PI / 2, -Math.PI / 2 + TAU * G.stats.astral / 100); ctx.stroke();
    const cf = Combat.cooldownFrac(G); ctx.lineWidth = 3; ctx.strokeStyle = cf >= 1 ? 'rgba(160,220,255,0.9)' : 'rgba(160,220,255,0.35)';
    ctx.beginPath(); ctx.arc(sx, sy, R - 8, -Math.PI / 2, -Math.PI / 2 + TAU * cf); ctx.stroke();
    if (G.combat && G.combat.denied) { ctx.fillStyle = 'rgba(255,120,90,0.9)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('recharging', sx, sy + R + 16); }
    ctx.textAlign = 'center'; ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,230,170,0.7)';
    ctx.fillText(`astral ${Math.round(G.stats.astral)}`, sx, sy - R - 8);
    if (G.state === 'DEMON_BATTLE' && G.sub.d) { // five fracture shards, no giant boss bar
      const h = G.sub.d.hits; const x0 = G.W / 2 - 60;
      for (let i = 0; i < 5; i++) { const x = x0 + i * 30, y = 22; ctx.save(); ctx.translate(x, y); ctx.rotate(0.5);
        ctx.fillStyle = i < h ? '#ffcf70' : 'rgba(255,255,255,0.15)'; ctx.fillRect(-5, -9, 10, 18); ctx.restore(); }
    }
    if (G.state === 'LESSER_ENTITIES' && G.sub.plan) { ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '11px system-ui'; ctx.fillText(`${G.sub.resolved}/${G.sub.plan.length}`, G.W / 2, 22); }
  },
  edgeArrow(ctx, tgt) { // points at an off-screen objective from the screen edge
    const G = Game, b = G.ben; const [tx, ty] = G.worldToScreen(tgt[0], tgt[1]);
    if (tx >= 0 && ty >= 0 && tx <= G.W && ty <= G.H) { const p = 0.5 + 0.5 * Math.sin(G.time * 4); ctx.strokeStyle = `rgba(255,215,110,${0.5 + 0.4 * p})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(tx, ty, 26 + p * 4, 12 + p * 2, 0, 0, TAU); ctx.stroke(); return; }
    const [bx, by] = G.worldToScreen(b.x, b.y); const a = Math.atan2(ty - by, tx - bx);
    const ex = clamp(G.W / 2 + Math.cos(a) * G.W * 0.42, 24, G.W - 24), ey = clamp(G.H / 2 + Math.sin(a) * G.H * 0.4, 50, G.H - 24);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(a); ctx.fillStyle = 'rgba(255,215,110,0.85)'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.fill(); ctx.restore();
  },
  streetHud(ctx) {
    const G = Game, b = G.ben, M = G.map; const tgt = (G.sub && G.sub.target) || STREET.safeway;
    // minimap (pre-rendered once per district)
    const k = Math.min(Math.min(180, G.W * 0.3) / M.w, Math.min(150, G.H * 0.36) / M.h), mw = M.w * k, mh = M.h * k, mx = G.W - mw - 12, my = 12;
    if (!M.mini || M.miniK !== k) { const c = document.createElement('canvas'); c.width = Math.ceil(mw); c.height = Math.ceil(mh); const x = c.getContext('2d'); x.fillStyle = 'rgba(200,200,190,0.6)';
      if (M.grid) { const g = M.grid; for (let i = 0; i < g.g.length; i++) if (g.g[i]) x.fillRect((i % g.w) * g.cell * k, ((i / g.w) | 0) * g.cell * k, Math.max(1, g.cell * k), Math.max(1, g.cell * k)); }
      else M.walk.forEach(r => x.fillRect(r[0] * k, r[1] * k, Math.max(1, r[2] * k), Math.max(1, r[3] * k)));
      M.mini = c; M.miniK = k; }
    ctx.fillStyle = M === COAST ? 'rgba(8,30,44,0.65)' : 'rgba(10,14,10,0.6)'; ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6); ctx.drawImage(M.mini, mx, my);
    if (G.sub && G.sub.foes) G.sub.foes.forEach(f => { if (!f.dying) { ctx.fillStyle = '#c08cff'; ctx.fillRect(mx + f.x * k - 2, my + f.y * k - 2, 4, 4); if (f.active) this.offscreenPointer(ctx, f.x, f.y, '#b58cff'); } });
    if (G.sub && G.sub.foes && G.sub.foesLeft > 0) { ctx.textAlign = 'center'; ctx.font = '600 12px system-ui'; ctx.fillStyle = '#d9c2ff'; ctx.fillText(`shades left: ${G.sub.foesLeft}`, G.W / 2, 52); }
    if (G.pigF) { ctx.fillStyle = '#e8b27a'; ctx.beginPath(); ctx.arc(mx + G.pigF.x * k, my + G.pigF.y * k, 2, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#ffd36a'; ctx.beginPath(); ctx.arc(mx + tgt[0] * k, my + tgt[1] * k, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx + b.x * k, my + b.y * k, 3, 0, TAU); ctx.fill();
    G.peds.each(p => { if (p.energetic) { ctx.fillStyle = 'rgba(170,110,255,0.9)'; ctx.fillRect(mx + p.x * k - 1, my + p.y * k - 1, 2, 2); } });
    // edge arrow toward objective
    const [tx, ty] = G.worldToScreen(tgt[0], tgt[1]);
    if (tx < 0 || ty < 0 || tx > G.W || ty > G.H) {
      const [bx, by] = G.worldToScreen(b.x, b.y); const a = Math.atan2(ty - by, tx - bx);
      const ex = clamp(G.W / 2 + Math.cos(a) * G.W * 0.42, 24, G.W - 24), ey = clamp(G.H / 2 + Math.sin(a) * G.H * 0.4, 50, G.H - 24);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(a); ctx.fillStyle = 'rgba(255,215,110,0.85)'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.fill(); ctx.restore();
    }
  },
  standinTag(ctx) {
    const G = Game; const list = [];
    if (!Assets.has('ben_v3')) list.push(Assets.has('ben_gold') ? 'Ben (first-pack motion set, recoloured gold/tan)' : 'Ben v3');
    if (G.mode === 'room' && G.room.plate === 'day' && Assets.standin('bg_day')) list.push('day room');
    if (G.mode === 'yard') { if (Assets.standin('bg_yard')) list.push('backyard'); if (!Assets.has('guinea')) list.push('guinea pig'); }
    if (G.state === 'LESSER_ENTITIES' && !Assets.has('lesser')) list.push('lesser entities');
    if (G.state === 'DEMON_BATTLE' && !Assets.has('demon')) list.push('demon');
    if ((G.inv.carryingBag || G.state === 'ROOM_EATING') && !Assets.has('props')) list.push('props');
    if (!list.length) return;
    ctx.textAlign = 'right'; ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('stand-in art: ' + list.join(', '), G.W - 10, G.H - 8);
  },
  touch(ctx) {
    if (!Input.touchMode) return;
    const G = Game; const ab = this.actionButton();
    ctx.globalAlpha = 0.55; ctx.fillStyle = 'rgba(255,215,120,0.25)'; ctx.strokeStyle = '#ffd77a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ab.x, ab.y, ab.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffe7a6'; ctx.font = '600 13px system-ui'; ctx.textAlign = 'center'; ctx.fillText('ACT', ab.x, ab.y + 5);
    const fb = this.fireButton(); if (fb) { ctx.fillStyle = 'rgba(120,200,255,0.22)'; ctx.strokeStyle = '#9fdcff'; ctx.beginPath(); ctx.arc(fb.x, fb.y, fb.r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d8f2ff'; ctx.fillText('FIRE', fb.x, fb.y + 5); ctx.fillStyle = '#ffe7a6'; }
    const st = Input.stick;
    if (st.active) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(st.ox, st.oy, 56, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(st.ox + st.x * 56, st.oy + st.y * 56, 22, 0, TAU); ctx.fill(); }
    else if (G.wantsStick()) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '11px system-ui'; ctx.fillText('drag here to move', 90, G.H - 30); }
    else { ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '11px system-ui'; ctx.fillText('tap anywhere to aim + fire', G.W / 2, G.H - 14); }
    ctx.globalAlpha = 1;
  },
  overlay(ctx, title, sub, bg = 'rgba(0,0,0,0.6)') {
    const G = Game; ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, G.W, G.H); ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe2a0'; ctx.font = `600 ${Math.min(34, G.W / 16)}px Georgia, serif`; ctx.fillText(title, G.W / 2, G.H / 2);
    ctx.fillStyle = '#d8d8e0'; ctx.font = '14px system-ui'; ctx.fillText(sub, G.W / 2, G.H / 2 + 34);
  },
  debug(ctx) {
    const G = Game; if (!G.stats) return; const b = G.ben, s = G.stats, i = G.inv;
    const d = G.sub && G.sub.d;
    const lines = [
      ...(G.state === 'KALALAU' ? Kal.debugLines() : []),
      `STATE ${G.state}  (t=${G.stateT.toFixed(1)}s)  next→ ${NEXT[G.state]}`,
      `done when: ${COMPLETE_WHEN[G.state]}`,
      `mode ${G.mode}  objective: ${G.objective}  seed ${G.seed}  day ${G.day}`,
      G.mode === 'street' && G.map ? `${G.map.key} tile r${Math.floor(b.y / 512) + 1}-c${Math.floor(b.x / 512) + 1}  ben (${b.x | 0},${b.y | 0}) dir ${DIRS[b.dir]}  peds ${G.peds.count()} cars ${G.cars.count()}` : `ben (${b.x | 0},${b.y | 0}) dir ${DIRS[b.dir]} pose ${b.pose}${b.asleep ? ' asleep' : ''}`,
      G.state === 'LESSER_ENTITIES' ? `entity phase: ${G.sub.cur ? `${G.sub.cur.type.name} hp${G.sub.cur.hp} from ${G.sub.cur.side}${G.sub.cur.dying ? ' dissolving' : ''}` : `silence ${Math.max(0, G.sub.silence).toFixed(1)}`}  resolved ${G.sub.resolved}/${G.sub.plan.length}  sides ${G.sub.sidesUsed.join(',')}` : '',
      d ? `demon mode ${d.mode}  orbit ${Math.min(d.hits, 4) + 1}/5  r=${d.r | 0}→${d.targetR}  hits ${d.hits}/5  dir ${d.dirSign > 0 ? 'cw' : 'ccw'}  lean ${d.lean.toFixed(2)}` : '',
      `music: want ${Music.want || '-'}  ${Music.muted ? 'MUTED' : ''}  errors ${G.errors || 0} ${G.lastError || ''}`,
      `energy: astral ${s.astral | 0}  body ${s.health | 0}  overload ${s.overload | 0}  hunger ${s.hunger | 0}  fatigue ${s.fatigue | 0}  $${s.money}`,
      `inv: carrots ${i.carrots}  groceries ${i.groceries}  carryingBag ${i.carryingBag}  stored ${i.groceriesStored}`,
      `combat: ${G.combat ? G.combat.state : '-'}  waves ${G.waves.count()}  fx ${G.fx.count()}  last save: ${G.lastSave}`,
      `assets: ${Object.entries(Assets.manifest.assets).filter(([k, a]) => a.standin).map(([k]) => k).join(', ')} = stand-in`,
      'N = force-complete state (debug)   ` = toggle overlay',
    ].filter(Boolean);
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    ctx.font = '11px ui-monospace, Menlo, monospace'; ctx.textAlign = 'left';
    const w = Math.min(G.W - 20, 640); ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(10, G.H - 20 - lines.length * 14, w, lines.length * 14 + 10);
    ctx.fillStyle = '#9dfcb0'; lines.forEach((l, k) => ctx.fillText(l, 16, G.H - 12 - (lines.length - k) * 14 + 6));
  },
};

/* test / tooling hook */
window.KOA = {
  get state() { return Game.state; }, game: Game, S, ROOM, YARD, STREET, TOWN, COAST, CFG, LOOP, NEXT, COMPLETE_WHEN, Assets,
  w2s: (x, y) => Game.worldToScreen(x, y),
};
window.addEventListener('load', () => Game.init());
