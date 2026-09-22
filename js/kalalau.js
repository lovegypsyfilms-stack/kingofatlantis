/* King of Atlantis — ACT 2: KALALAU. Free-roam chapter over eight 3072x1536 photoreal masters (near-top-down, north up).
   Ben here is the lean, hatted, crownless Kalalau Ben (runtime/kalalau/kben). All collision comes from layout.json
   (corridors + open polygons rasterised to an 8 px grid), never from the artwork, and is shared by day and night.
   The chapter is one Game state (KALALAU) with its own phase machine (Kal.phase) so branches can loop freely. */
'use strict';

const KCFG = {
  benH: 66, zoomMul: 0.85, walk: 190, run: 285, npcWalk: 95, rangerWalk: 120, rangerRun: 265, catchR: 28,
  dayLength: 300,            // seconds of real time per in-game day (clock 6:00 -> 6:00)
  nightfallHour: 19, dawnHour: 6,
  chaseGiveUp: 75,           // s without contact before rangers stand down
  hideSearch: 14,            // s rangers search a map Ben hid in before moving on
  heli: { approach: 6, hover: 3, land: 2.5 },
  fire: { ignite: 1.0, gray: 5, black: 9, burned: 13 },
  wind: { telegraph: 0.75, react: 1.5, gust: [2.0, 3.0], force: [170, 260], interval: [4.5, 8.0], shelter: 22, fallMargin: 14, scaleTelegraph: 0.85, scaleForce: 1.25 },
  kama: { stage: 1.4, hitsToYield: 5, invuln: 0.9, spearEvery: 4.2, spearWarn: 0.8, spearReach: 170, mistEvery: 5.5, vineEvery: 4.0, spearDrain: 12, wakeR: 650 },
  push: { range: 380, cost: 3, cooldown: 0.55, speed: 1100 },
  marchers: 6, menehune: 3, wildCarrots: [2, 4], carrotPickR: 60,
};

// Guided order of events for the play-test: each step names a map and either a portal to take or a thing to do.
// The HUD shows the step in large letters at the bottom and points an arrow at the target. Story events
// (chase, night, Kamapuaʻa, the ledge) override the text while they are active.
const GUIDE = [
  { id: 'wake', map: 'campsite', text: 'WAKE UP — press E or tap', done: K => K.phase !== 'TENT_WAKE' },
  { id: 'toBeach', map: 'campsite', portal: 'S', text: 'GO SOUTH THROUGH THE TREES TO THE BEACH', done: K => K.flags.visited_beach },
  { id: 'social', map: 'beach', point: M => M.social[0], text: 'WALK UP TO THE HIKERS AND TALK (E)', done: K => !!K.outcomes.social },
  { id: 'backToCamp', map: 'beach', portal: 'N', text: 'HEAD BACK NORTH TO YOUR CAMP', done: K => K.flags.visitors === 'arrived' || !!K.outcomes.confrontation },
  { id: 'visitors', map: 'campsite', point: M => [M.camp.stand[0], M.camp.stand[1] + 40], text: 'THE HIKERS ARE AT YOUR CAMP — GO AND DEAL WITH THEM', done: K => !!K.outcomes.confrontation },
  { id: 'toBeach2', map: 'campsite', portal: 'S', text: 'GO DOWN TO THE BEACH — SOMEONE IS COMING IN', done: K => K.flags.raid && K.flags.raid !== 'blocked' },
  { id: 'skis', map: 'beach', point: M => M.skiShore[0], text: 'TWO JET SKIS — WATCH THEM LAND', done: K => K.flags.raid === 'toCamp' || K.flags.raid === 'atCamp' || K.flags.raid === 'done' },
  { id: 'raid', map: 'campsite', point: M => [M.camp.stand[0], M.camp.stand[1] + 40], text: 'BACK TO CAMP, FAST — THEY ARE HEADING FOR YOUR TENT', done: K => !!K.outcomes.raid || K.camp.state !== 'intact' },
  { id: 'toValley', map: 'campsite', portal: 'E', text: 'HEAD EAST INTO THE VALLEY', done: K => K.flags.visited_valley && (K.outcomes.raid || K.camp.state !== 'intact') },
  { id: 'toHill', map: 'valley', portal: 'SE', text: 'SOUTH-EAST TO RED DIRT HILL — THE WAY OUT', done: K => K.flags.visited_red },
  { id: 'toTrail', map: 'red-dirt-hill', portal: 'NE', text: 'CLIMB THE SWITCHBACKS TO THE TOP-RIGHT — THE TRAIL OUT', done: K => K.flags.visited_escape },
  { id: 'kamaTrail', map: 'escape-trail', point: M => M.kamaTrail, text: 'NIGHT ON THE TRAIL — WALK ON. SOMETHING IS WAITING IN THE MIST', done: K => !!K.outcomes.kamapuaa },
  { id: 'toLedge', map: 'escape-trail', portal: 'W', text: 'FOLLOW THE TRAIL WEST (LEFT) TO CRAWLER\'S LEDGE', done: K => K.flags.visited_crawlers },
  { id: 'ledge', map: 'crawlers-ledge', portal: 'N', text: 'CRAWLER\'S LEDGE — HOLD RIGHT INTO THE WALL WHEN THE WIND RISES. CLIMB TO THE TOP-LEFT', done: K => K.phase === 'CHAPTER_EXIT' },
];
// Play-test option: the guinea pig companion on the maps, Act 1 (day 2+) and Kalalau (default OFF). Toggle on the title screen, or ?pig=1 / ?pig=0.
const KalOpts = {
  get pig() { const q = new URLSearchParams(location.search); if (q.has('pig')) return q.get('pig') !== '0'; try { return localStorage.getItem('koa-kal-pig') === '1'; } catch (e) { return false; } },
  set pig(v) { try { localStorage.setItem('koa-kal-pig', v ? '1' : '0'); } catch (e) { } },
};
const Kal = {
  L: null, maps: {}, map: null, mapId: null, phase: 'TENT_WAKE', night: false, clock: 7.0, t: 0,
  actors: [], rangers: [], heli: null, camp: { state: 'intact', tentOpen: false }, alert: 0, inv: { knife: true, knifeOut: false },
  outcomes: {}, flags: {}, checkpoint: null, title: null, choice: null, dialog: null, hidden: null, chase: null,
  ledge: null, kama: null, marchers: null, menehune: [], fx: [], pool: [], debugView: { collision: false, exits: false }, msgLog: [],

  /* ------------------------------------------------ world data */
  load() {
    if (this.L) return true;
    const L = Assets.meta.kal_layout; if (!L) return false;
    this.L = L;
    for (const id in L.maps) this.maps[id] = Object.assign({ id, w: 3072, h: 1536, grid: null }, L.maps[id]);
    return true;
  },
  grid(M) { // rasterise the hand-authored navigation layer (deterministic; identical for day & night)
    if (M.grid) return M.grid;
    const C = 8, w = M.w / C, h = M.h / C, g = new Uint8Array(w * h);
    const segs = []; for (const c of M.corridors) for (let i = 0; i + 1 < c.pts.length; i++) segs.push([c.pts[i], c.pts[i + 1], c.w, c]);
    const near = (px, py, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1; let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; return [a[0] + dx * t, a[1] + dy * t]; };
    const d2seg = (px, py, a, b) => { const q = near(px, py, a, b); return Math.hypot(px - q[0], py - q[1]); };
    // junction fix-up: a corridor end that stops just short of another corridor gets a short connector (data stays hand-authored; this only closes sub-cell gaps)
    for (const c of M.corridors) for (const e of [c.pts[0], c.pts[c.pts.length - 1]]) {
      let bd = 1e9, bq = null, bw = 0; for (const [a, b, w, oc] of segs) { if (oc === c) continue; const q = near(e[0], e[1], a, b), d = Math.hypot(e[0] - q[0], e[1] - q[1]); if (d < bd) { bd = d; bq = q; bw = w; } }
      if (bq && bd > 4 && bd < 220 && !(e[0] < 8 || e[1] < 8 || e[0] > M.w - 8 || e[1] > M.h - 8)) segs.push([e, bq, Math.min(c.w, bw), c]);
    }
    // hiding spots and camp/LZ points get a short stub to the nearest corridor so they are always reachable
    const stubs = [...(M.hides || [])]; if (M.camp) stubs.push(M.camp.stand); if (M.lz) stubs.push(M.lz); if (M.kama) stubs.push(M.kama); if (M.trailhead) stubs.push(M.trailhead);
    for (const e of stubs) { let bd = 1e9, bq = null; for (const [a, b] of segs) { const q = near(e[0], e[1], a, b), d = Math.hypot(e[0] - q[0], e[1] - q[1]); if (d < bd) { bd = d; bq = q; } }
      for (const poly of M.open) if (pointInPoly(e[0], e[1], poly)) bd = 0;
      if (bq && bd > 0) segs.push([e, bq, 34, null]); }
    for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
      const x = (cx + 0.5) * C, y = (cy + 0.5) * C; let ok = false;
      for (const [a, b, r] of segs) if (d2seg(x, y, a, b) <= r) { ok = true; break; }
      if (!ok) for (const poly of M.open) if (pointInPoly(x, y, poly)) { ok = true; break; }
      if (ok && (x < 6 || y < 6 || x > M.w - 6 || y > M.h - 6)) ok = false;
      g[cy * w + cx] = ok ? 1 : 0;
    }
    const g2 = new Uint8Array(w * h); // eroded interior (all 8 neighbours walkable): paths keep clear of corridor edges
    for (let cy = 1; cy < h - 1; cy++) for (let cx = 1; cx < w - 1; cx++) { if (!g[cy * w + cx]) continue; let ok = 1; for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!g[(cy + dy) * w + cx + dx]) { ok = 0; break; } g2[cy * w + cx] = ok; }
    M.grid = { cell: C, w, h, g, g2 }; return M.grid;
  },
  can(x, y, M = this.map) { const G = this.grid(M); if (x < 0 || y < 0 || x >= M.w || y >= M.h) return false; return G.g[Math.floor(y / G.cell) * G.w + Math.floor(x / G.cell)] === 1; },
  snap(M, x, y) { // nearest walkable cell centre
    const G = this.grid(M), C = G.cell, cx = Math.floor(x / C), cy = Math.floor(y / C); let best = null, bd = 1e9;
    for (let dy = -40; dy <= 40; dy++) for (let dx = -40; dx <= 40; dx++) { const X = cx + dx, Y = cy + dy; if (X < 0 || Y < 0 || X >= G.w || Y >= G.h || !G.g[Y * G.w + X]) continue; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [(X + 0.5) * C, (Y + 0.5) * C]; } }
    return best || [x, y];
  },
  portalOf(M, id) { return M.portals.find(p => p.id === id); },
  // route between maps (BFS over portals) -> next portal to take from map `from` toward map `to`
  nextPortal(from, to) {
    if (from === to) return null;
    const prev = { [from]: null }, q = [from];
    while (q.length) { const m = q.shift(); if (m === to) break; for (const p of this.maps[m].portals) { const n = p.to[0]; if (n === 'EXIT' || prev[n] !== undefined) continue; prev[n] = { m, p }; q.push(n); } }
    if (prev[to] === undefined) return null;
    let cur = to, step = null; while (prev[cur]) { step = prev[cur]; cur = step.m; } return step.p;
  },
  path(M, fx, fy, tx, ty, interior = true) { // grid BFS (interior cells first) + line-of-sight pull
    const G = this.grid(M), C = G.cell, w = G.w, h = G.h, g = interior ? G.g2 : G.g, can = (x, y) => this.can(x, y, M);
    const clear = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(d / 4), nx = -(b[1] - a[1]) / (d || 1) * 3, ny = (b[0] - a[0]) / (d || 1) * 3;
      for (let i = 1; i <= n; i++) { const t = i / n, x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t); if (!can(x, y)) return false; } return true; };
    if (can(tx, ty) && clear([fx, fy], [tx, ty])) return [[tx, ty]];
    const ci = (x, y) => clamp(Math.floor(y / C), 0, h - 1) * w + clamp(Math.floor(x / C), 0, w - 1);
    const s = ci(fx, fy); let t = ci(tx, ty);
    const nearestCell = (idx, R) => { if (g[idx]) return idx; let best = -1, bd = 1e9; const cx = idx % w, cy = (idx / w) | 0; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= w || y >= h || !g[y * w + x]) continue; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = y * w + x; } } return best; };
    const s0 = nearestCell(s, 6), t0 = nearestCell(t, 30);
    if (s0 < 0 || t0 < 0) return interior ? this.path(M, fx, fy, tx, ty, false) : [[fx, fy]];
    const s1 = s0; t = t0;
    const prev = new Int32Array(w * h).fill(-1), q = new Int32Array(w * h); let qh = 0, qt = 0; q[qt++] = s1; prev[s1] = s1;
    while (qh < qt) { const u = q[qh++]; if (u === t) break; const ux = u % w, uy = (u / w) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const x = ux + dx, y = uy + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue; const v = y * w + x; if (prev[v] >= 0 || !g[v]) continue; prev[v] = u; q[qt++] = v; } }
    if (prev[t] < 0) return interior ? this.path(M, fx, fy, tx, ty, false) : [[tx, ty]];
    const cells = []; for (let v = t; v !== s1; v = prev[v]) cells.unshift([(v % w + 0.5) * C, (((v / w) | 0) + 0.5) * C]);
    if (s1 !== s) cells.unshift([(s1 % w + 0.5) * C, (((s1 / w) | 0) + 0.5) * C]);
    cells.push(can(tx, ty) ? [tx, ty] : cells[cells.length - 1] || [fx, fy]);
    const out = []; let from = [fx, fy], i = 0;
    while (i < cells.length) { let j = cells.length - 1; while (j > i && !clear(from, cells[j])) j--; out.push(cells[j]); from = cells[j]; i = j + 1; }
    return out;
  },

  /* ------------------------------------------------ chapter start / save */
  begin(fresh = true) {
    const G = Game; this.load();
    if (fresh) {
      this.carrots = {};
      Object.assign(this, { phase: 'TENT_WAKE', night: false, clock: 7.2, t: 0, actors: [], rangers: [], heli: null, camp: { state: 'intact', tentOpen: false }, alert: 0,
        inv: { knife: true, knifeOut: false }, outcomes: {}, flags: {}, checkpoint: null, hidden: null, chase: null, ledge: null, kama: null, marchers: null, menehune: [], fx: [], msgLog: [] });
      G.stats = G.stats || { health: 100, astral: 100, overload: 0, money: 0, hunger: 30, fatigue: 30 }; G.stats.health = 100;
      this.spawnCast();
      this.enterMap('campsite', null, [1440, 700]);
      const b = G.ben; b.x = 1440; b.y = 690; b.asleep = true; b.dir = 4;
      this.camp.tentOpen = false; this.objective('Wake up');
      G.center = { text: 'ACT 2: KALALAU', t: 0, dur: 4 };
    }
    G.mode = 'kal'; G.map = null;
  },
  snapshot() {
    const G = Game;
    return { phase: this.phase, night: this.night, clock: this.clock, mapId: this.mapId, ben: [G.ben.x, G.ben.y], inv: { ...this.inv }, camp: { ...this.camp }, alert: this.alert,
      checkpoint: this.checkpoint, outcomes: { ...this.outcomes }, flags: { ...this.flags }, heli: this.heli ? { state: this.heli.state === 'gone' ? 'gone' : 'landed' } : null,
      actors: this.actors.map(a => ({ id: a.id, kind: a.kind, map: a.map, x: a.x, y: a.y, pack: a.pack, gone: !!a.gone })), carrots: this.carrots || {} };
  },
  restore(s) {
    const G = Game; this.load();
    Object.assign(this, { night: s.night, clock: s.clock, inv: { ...s.inv }, camp: { ...s.camp }, alert: 0, checkpoint: s.checkpoint, outcomes: { ...s.outcomes }, flags: { ...s.flags },
      hidden: null, chase: null, ledge: null, kama: null, marchers: null, menehune: [], fx: [], rangers: [], msgLog: [] });
    this.spawnCast(); this.carrots = s.carrots || {};
    for (const a of s.actors || []) { const A = this.actors.find(x => x.id === a.id); if (A) Object.assign(A, { map: a.map, x: a.x, y: a.y, pack: a.pack, gone: a.gone }); }
    this.heli = s.heli && s.heli.state !== 'gone' ? { state: 'landed', x: 0, y: 0, t: 0 } : null; if (this.heli) { const lz = this.maps.beach.lz; this.heli.x = lz[0]; this.heli.y = lz[1]; }
    this.phase = ['RANGER_CHASE', 'HIDDEN', 'ARRESTED', 'FIGHT', 'HELICOPTER_RESPONSE'].includes(s.phase) ? 'FREE_EXPLORE' : s.phase;
    this.enterMap(s.mapId, null, s.ben); G.mode = 'kal'; G.ben.asleep = s.phase === 'TENT_WAKE';
    this.objective(this.phase === 'HIKE_OUT' ? 'Hike out — Red Dirt Hill, the trail, Crawler\'s Ledge' : this.phase === 'TENT_WAKE' ? 'Wake up' : 'Explore');
  },
  save() { if (Game.state === 'KALALAU') Save.write(Object.assign(Game.snapshotSave('KALALAU'), { kal: this.snapshot() })); },

  /* ------------------------------------------------ cast */
  spawnCast() {
    const B = this.maps.beach, C = this.maps.campsite; this.actors = [];
    const hk = [ // seven adult hikers: couple (h0 woman, h1 man), older man h2, two young women h3 h4, two young men h5 h6
      { id: 'h0', name: 'Mara', role: 'couple' }, { id: 'h1', name: 'Dane', role: 'couple' }, { id: 'h2', name: 'Walt', role: 'older' },
      { id: 'h3', name: 'Ines', role: 'young-woman' }, { id: 'h4', name: 'Rosie', role: 'young-woman' }, { id: 'h5', name: 'Cole', role: 'young-man' }, { id: 'h6', name: 'Theo', role: 'young-man' }];
    hk.forEach((h, i) => this.actors.push({ ...h, kind: 'hiker', sheet: 'hikers', hi: i, map: 'beach', x: B.social[i][0], y: B.social[i][1], dir: 4, pack: true, t: Math.random() * 3, mode: 'idle', speed: KCFG.npcWalk, path: null, alpha: 1 }));
    const locals = [{ id: 'kai', name: 'Kai' }, { id: 'leilani', name: 'Leilani' }, { id: 'makani', name: 'Makani' }, { id: 'noa', name: 'Noa' }];
    locals.forEach((l, i) => this.actors.push({ ...l, kind: 'local', sheet: 'camp', map: null, x: 0, y: 0, dir: 4, t: 0, mode: 'away', speed: KCFG.npcWalk * 1.15, path: null, ski: i < 2 ? 'r' : 'b', alpha: 1 }));
    this.skis = [{ id: 'ski_r', map: null, x: 0, y: 0, mode: 'away' }, { id: 'ski_b', map: null, x: 0, y: 0, mode: 'away' }];
    this.actors.forEach(a => { a.gone = false; });
  },
  actorsIn(mapId) { return this.actors.filter(a => a.map === mapId && !a.gone); },

  /* ------------------------------------------------ map transitions */
  enterMap(id, portalId = null, at = null) {
    const G = Game, M = this.maps[id]; this.mapId = id; this.map = M; this.grid(M); G.map = null;
    let x, y, dir = G.ben.dir;
    if (at) { [x, y] = at; } else if (portalId) { const p = this.portalOf(M, portalId); x = p.x; y = p.y; dir = (p.dir + 4) % 8; const dx = Math.sin(dir * TAU / 8), dy = -Math.cos(dir * TAU / 8); x += dx * (p.r + 80); y += dy * (p.r + 80); }
    else { x = M.w / 2; y = M.h / 2; }
    if (!this.can(x, y, M)) { [x, y] = this.snap(M, x, y); }
    Object.assign(G.ben, { x, y, dir, h: KCFG.benH, moving: false, pose: 'idle', asleep: false });
    G.walkTarget = null; G.cam.x = x; G.cam.y = y; G.cam.z = this.zoom(); this.fx = []; this.pool = [];
    this.title = { text: M.title, t: 0 }; this.lastPortal = portalId; this.portalCd = 1.2; G.waves.clear();
    this.pig = KalOpts.pig ? { x: x + 30, y: y + 24, t: 0, facing: -1, moving: false, cool: 0 } : null; G.inv.pigCharges = G.inv.pigCharges || 0; G.inv.carrots = G.inv.carrots || 0;
    if (!this.carrots) this.carrots = {};
    if (!this.carrots[id]) { // wild carrots grow at random spots along the paths of each map (seeded once per map)
      const r = G.rngFor('carrots-' + id), n = KCFG.wildCarrots[0] + Math.floor(r() * (KCFG.wildCarrots[1] - KCFG.wildCarrots[0] + 1)), list = [];
      for (let i = 0; i < n; i++) { const c = M.corridors[Math.floor(r() * M.corridors.length)], k = Math.floor(r() * (c.pts.length - 1)), t = r(), pt = [lerp(c.pts[k][0], c.pts[k + 1][0], t) + (r() - 0.5) * 40, lerp(c.pts[k][1], c.pts[k + 1][1], t) + (r() - 0.5) * 40]; if (this.can(pt[0], pt[1], M)) list.push({ x: pt[0], y: pt[1], taken: false }); }
      this.carrots[id] = list;
    }
    if (!this.flags['visited_' + id]) { this.flags['visited_' + id] = true; }
    this.flags['visited_' + { 'river-jungle': 'river', 'rear-cliff-clearing': 'rear', 'red-dirt-hill': 'red', 'escape-trail': 'escape', 'crawlers-ledge': 'crawlers' }[id]] = true;
    if (id === 'crawlers-ledge') this.ledgeEnter();
    if (this.alert === 1 && !this.chase && id === 'beach' && this.phase === 'FREE_EXPLORE') { // reported after a threat: a foot patrol of two, no helicopter
      const lz = M.lz; this.rangers = ['A', 'C'].map((v, i) => ({ id: 'p' + v, v, map: 'beach', x: lz[0] + i * 60, y: lz[1] + 40, dir: 4, t: 0, mode: 'pursue', path: null, searchT: 0, alpha: 1, speed: KCFG.rangerRun * 0.95 }));
      this.phase = 'RANGER_CHASE'; this.chase = { t: 0, lastSeen: 0, contactT: 0 }; this.objective('Two rangers on the beach are looking for him — get away and hide'); this.say('Two DNLR rangers, on foot, and they\'ve seen him', 3);
    }
    if (id === 'escape-trail' && !this.outcomes.kamapuaa && !this.night) { this.clock = KCFG.nightfallHour + 0.4; this.flags.debugNight = true; this.setNight(true); this.say('Night falls fast on the trail out. The mist is moving against the wind.', 3.6); }
    if (id === 'rear-cliff-clearing' && this.night && !this.outcomes.kamapuaa && !this.kama) this.kamaBegin(M.kama);
    if (id === 'campsite' && this.outcomes.social && !this.flags.visitors) this.flags.socialAt = this.clock - 1; // the visitors turn up as he gets home
    this.marchers = null; this.menehune = [];
    if (this.night) this.nightSpawns();
    Audio.ambience({ street: M.ambient === 'surf' || M.ambient === 'gale' ? 0.3 : 0.08, morning: this.night ? 0 : 0.25, evening: this.night ? 0.35 : 0 }, 1.2);
    this.save();
  },
  zoom() { const G = Game; return clamp(Math.max(G.H / 760, G.W / 1350), 0.45, 2.2) * KCFG.zoomMul; },
  usePortal(p) {
    const G = Game;
    if (p.to[0] === 'EXIT') { this.phase = 'CHAPTER_EXIT'; G.go('KALALAU_END', { fade: 1.4 }); return; }
    if (this.phase === 'HIKE_OUT' && p.to[0] === 'valley') { G.say('"Don\'t come back." Ben keeps walking.', 2.5); return; }
    if (this.hidden) return;
    G.go('KALALAU', { fade: 0.45 }); this.pending = { map: p.to[0], portal: p.to[1] };
  },

  /* ------------------------------------------------ per-frame */
  update(dt, live) {
    const G = Game, b = G.ben, M = this.map; this.t += dt;
    if (this.pending) { const p = this.pending; this.pending = null; this.enterMap(p.map, p.portal); }
    if (this.title) { this.title.t += dt; if (this.title.t > 3) this.title = null; }
    // clock
    if (this.phase !== 'CHAPTER_EXIT') { this.clock += dt * 24 / KCFG.dayLength; if (this.clock >= 24) this.clock -= 24; }
    const wantNight = this.clock >= KCFG.nightfallHour || this.clock < KCFG.dawnHour;
    if (wantNight !== this.night && !this.flags.debugNight) this.setNight(wantNight);
    // camera
    const z = this.zoom(), vw = G.W / z, vh = G.H / z;
    G.camTo(clamp(b.x, vw / 2, M.w - vw / 2), clamp(b.y, vh / 2, M.h - vh / 2), z, 6, dt);
    this.portalCd = Math.max(0, this.portalCd - dt);
    if (!live) { b.moving = false; return; }
    if (this.choice) { this.choiceUpdate(); b.moving = false; this.actorsUpdate(dt); return; }
    if (this.dialog) { this.dialog.t += dt; if (this.dialog.t > this.dialog.dur || Input.action() || Input.fire()) { const next = this.dialog.then; this.dialog = null; if (next) next(); } b.moving = false; this.actorsUpdate(dt); return; }
    if (G.debug) this.debugKeys();
    switch (this.phase) {
      case 'TENT_WAKE': this.tentWake(dt); break;
      case 'ARRESTED': this.arrestedUpdate(dt); break;
      case 'FIGHT': this.fightUpdate(dt); break;
      case 'CHAPTER_EXIT': break;
      default: this.freeUpdate(dt);
    }
    this.actorsUpdate(dt); this.heliUpdate(dt); this.rangersUpdate(dt); this.fireUpdate(dt); this.fxUpdate(dt); this.pigUpdate(dt);
    if (this.night) this.nightUpdate(dt);
    if (this.kama) this.kamaUpdate(dt);
    else if (this.mapId === 'escape-trail' && this.map.kamaTrail && !this.outcomes.kamapuaa && dist(Game.ben.x, Game.ben.y, this.map.kamaTrail[0], this.map.kamaTrail[1]) < KCFG.kama.wakeR) this.kamaBegin(this.map.kamaTrail);
    this.pushUpdate(dt);
    if (this.mapId === 'crawlers-ledge' && this.ledge) this.ledgeUpdate(dt);
    this.storyBeats(dt);
  },
  objective(t) { Game.objective = t; },
  // guide: first undone step; if Ben is on the wrong map, point him to the exit that leads to the step's map
  guideStep() {
    const hike = this.phase === 'HIKE_OUT' || (this.phase === 'KAMAPUAA_ENCOUNTER' && this.prevPhase === 'HIKE_OUT');
    const step = hike ? GUIDE.find(g => ['toHill', 'toTrail', 'kamaTrail', 'toLedge', 'ledge'].includes(g.id) && !g.done(this)) : GUIDE.find(g => !g.done(this));
    if (!step) return null;
    const M = this.map; let text = step.text, target = null, portal = null;
    if (step.map === this.mapId) { if (step.portal) { portal = this.portalOf(M, step.portal); target = [portal.x, portal.y]; } else if (step.point) target = step.point(M); }
    else { const p = this.nextPortal(this.mapId, step.map); if (p) { portal = p; target = [p.x, p.y]; text = `GO TO ${this.maps[step.map].title.toUpperCase()} — TAKE THE ${p.id} EXIT`; } }
    // live events override the wording
    if (this.chase && !this.hidden) text = 'RANGERS! RUN — FIND A BUSH WITH THE EYE ICON AND HIDE (E) WHEN NONE ARE ON SCREEN';
    else if (this.hidden) text = 'HIDDEN — WAIT FOR THE SEARCH TO PASS';
    else if (this.kama && this.kama.mode === 'combat') text = this.kama.warn > 0 ? 'THE SPEAR IS COMING — BACK OFF!' : `KAMAPUAʻA — PUSH HIM BACK WITH SPACE / FIRE (${this.kama.hits}/${KCFG.kama.hitsToYield}). SPACE ALSO CUTS VINES`;
    else if (this.kama && this.kama.mode !== 'dissolve') text = 'KAMAPUAʻA IS TAKING SHAPE…';
    else if (this.marchers && this.marchers.map === this.mapId && this.marchers.warned && !this.marchers.veer) text = 'NIGHT MARCHERS — KNEEL (E) TO LET THEM PASS, OR PUSH THEM BACK (SPACE)';
    else if (this.ledge && this.ledge.gust) text = this.ledge.gust.phase === 'gust' ? 'HOLD RIGHT!' : 'WIND COMING — GET TO THE CLIFF WALL, HOLD RIGHT';
    else if (this.choice) text = 'CHOOSE — press 1, 2, 3, 4 or tap';
    else if (this.dialog) text = 'E OR TAP TO CONTINUE';
    return { step, text, target, portal };
  },
  say(t, d = 2.6) { Game.say(t, d); this.msgLog.push(t); },
  speak(who, text, dur = 2.8, then = null) { this.dialog = { who, text, t: 0, dur, then }; this.msgLog.push(`${who}: ${text}`); },

  /* ------------------------------------------------ Ben movement + interactions */
  freeUpdate(dt) {
    const G = Game, b = G.ben, M = this.map;
    if (this.hidden) { this.hiddenUpdate(dt); return; }
    const run = Input.keys.has('ShiftLeft') || Input.keys.has('ShiftRight') || (this.chase && true);
    const sp = (run ? KCFG.run : KCFG.walk) * (b.pose === 'hurt' ? 0.5 : 1);
    if (b.pose === 'hurt' || b.pose === 'brace') { b.poseT = (b.poseT || 0) + dt; if (b.poseT > 0.6) b.pose = 'idle'; }
    const ledgeCan = (x, y) => this.can(x, y);
    G.moveBen(dt, sp, ledgeCan);
    if (Input.pressed.has('KeyK') && this.inv.knife) { this.inv.knifeOut = !this.inv.knifeOut; this.say(this.inv.knifeOut ? 'Knife drawn — this changes how people react' : 'Knife put away', 1.8); }
    // portals
    if (this.portalCd <= 0) for (const p of M.portals) if (dist(b.x, b.y, p.x, p.y) < p.r) { this.usePortal(p); return; }
    // interactions
    const near = this.nearest();
    this.prompt = null; this.nearestPt = near ? [near.x, near.y] : null;
    if (near) {
      if (near.type === 'hide') this.prompt = { text: this.chase ? 'Hide' : 'Hide (dense shrub)', fn: () => this.tryHide(near.ref) };
      else if (near.type === 'hiker' && !this.outcomes.social && this.mapId === 'beach' && this.phase === 'BEACH_SOCIAL') this.prompt = { text: 'Talk to the hikers', fn: () => this.beachSocial() };
      else if (near.type === 'hiker' && this.flags.visitors === 'arrived' && !this.outcomes.confrontation && near.ref.map === 'campsite') this.prompt = { text: 'Deal with the visitors', fn: () => this.campConfrontation() };
      else if (near.type === 'local' && this.flags.raid === 'atCamp' && !this.outcomes.raid) this.prompt = { text: 'Face them', fn: () => this.raidConfrontation() };
      else if (near.type === 'carrot') this.prompt = { text: 'Pick wild carrots (+1)', fn: () => { near.ref.taken = true; G.inv.carrots++; Audio.sfx('sparkle'); this.sparkle(near.x, near.y - 10); this.say(`Wild carrots — ${G.inv.carrots} in the bag`, 1.8); this.outcomes.carrots = (this.outcomes.carrots || 0) + 1; this.save(); } };
      else if (near.type === 'tent') this.prompt = { text: this.camp.state === 'burned' ? 'What\'s left of the tent' : 'Rest at the tent', fn: () => this.restAtTent() };
      else if (near.type === 'marchers' && !this.marchers.veer) this.prompt = { text: 'Kneel and look away', fn: () => { b.pose = 'kneel'; b.poseT = 0; this.flags.kneeling = 2.5; } };
    }
    if (this.prompt && Input.action()) { G.walkTarget = null; this.prompt.fn(); }
    if (this.flags.kneeling > 0) { this.flags.kneeling -= dt; b.pose = 'kneel'; b.moving = false; if (this.flags.kneeling <= 0) b.pose = 'idle'; }
  },
  nearest() {
    const G = Game, b = G.ben, M = this.map; let best = null, bd = 1e9;
    const consider = (type, ref, x, y, r) => { const d = dist(b.x, b.y, x, y); if (d < r && d < bd) { bd = d; best = { type, ref, x, y }; } };
    for (const h of M.hides || []) consider('hide', h, h[0], h[1], 70);
    if (this.pig) for (const c of (this.carrots && this.carrots[this.mapId]) || []) if (!c.taken) consider('carrot', c, c.x, c.y, KCFG.carrotPickR);
    for (const a of this.actorsIn(this.mapId)) consider(a.kind, a, a.x, a.y, 90);
    if (this.mapId === 'campsite') consider('tent', M.camp, M.camp.tent[0], M.camp.tent[1] + 40, 90);
    if (this.marchers && this.marchers.map === this.mapId) { const m = this.marchers.line[0]; consider('marchers', this.marchers, m.x, m.y, 260); }
    return best;
  },
  tentWake(dt) {
    const G = Game, b = G.ben;
    this.prompt = { text: 'Wake up', fn: null };
    if (Input.action() || Input.pointer.tapQueue.length) {
      b.asleep = false; this.camp.tentOpen = true; b.x = this.map.camp.stand[0]; b.y = this.map.camp.stand[1]; b.dir = 4;
      this.phase = 'BEACH_SOCIAL'; this.objective('Walk down to the beach'); this.say('Morning at Kalalau. The beach is south, past the trees.', 3);
      Audio.sfx('bag'); this.save();
    }
  },
  restAtTent() {
    if (this.camp.state === 'burned') { this.say('Ash and melted nylon. Everything he owned.', 3); return; }
    const G = Game; G.stats.health = Math.min(100, G.stats.health + 25); this.say('Ben rests a while. Body +25', 2.2);
    if (this.alert > 0 && !this.chase) this.alert = 0;
  },

  /* ------------------------------------------------ dialogue + choices */
  ask(text, options) { this.choice = { text, options, t: 0 }; Game.walkTarget = null; },
  choiceUpdate() {
    const c = this.choice; c.t += 1 / 60; let pick = -1;
    for (let i = 0; i < c.options.length; i++) if (Input.pressed.has('Digit' + (i + 1)) || Input.pressed.has('Numpad' + (i + 1))) pick = i;
    const tap = Input.pointer.tapQueue[0];
    if (tap && c.rects) c.rects.forEach((r, i) => { if (tap.x >= r[0] && tap.x <= r[0] + r[2] && tap.y >= r[1] && tap.y <= r[1] + r[3]) pick = i; });
    if (pick >= 0 && c.t > 0.25) { const o = c.options[pick]; this.choice = null; this.msgLog.push('> ' + o.label); o.fn(); }
  },
  // 4. Beach social scene: Ben approaches the two young women; keep it awkward, not explicit; a companion warns him off.
  beachSocial() {
    const women = this.actors.filter(a => ['h3', 'h4'].includes(a.id)), cole = this.actors.find(a => a.id === 'h5');
    women.forEach(w => { w.dir = 4; }); cole.dir = 4;
    this.speak('Ben', 'Hey. You two just hike in? I know this valley — the falls, the swimming holes. I could show you around.', 3.4, () =>
      this.speak(women[0].name, 'Oh — um. Thanks, but we\'re good. We\'re with our friends.', 3, () =>
        this.speak(cole.name, 'Hey, buddy. Back off.', 2.2, () =>
          this.ask('Cole is standing between Ben and the women.', [
            { label: 'Step away — "Sorry. Didn\'t mean anything by it."', fn: () => { this.speak('Ben', 'Sorry. Didn\'t mean anything by it. Enjoy the valley.', 2.6, () => { this.outcomes.social = 'stepped-away'; this.socialDone(); }); } },
            { label: 'Push it — "I\'m just being friendly, man."', fn: () => { this.speak('Ben', 'I\'m just being friendly, man.', 2, () => this.speak(cole.name, 'Be friendly somewhere else.', 2.2, () => { this.outcomes.social = 'pushed'; this.flags.tension = 1; this.socialDone(); })); } },
          ]))));
  },
  socialDone() {
    this.phase = 'FREE_EXPLORE'; this.objective('Explore the valley');
    this.say(this.outcomes.social === 'pushed' ? 'The group turns its back on Ben.' : 'Ben walks off along the sand.', 2.6);
    this.flags.socialAt = this.clock; this.save();
  },
  // Later beat: members of the hiking party come near Ben's camp.
  campConfrontation() {
    const cole = this.actors.find(a => a.id === 'h5'), dane = this.actors.find(a => a.id === 'h1');
    this.phase = 'CAMP_CONFRONTATION';
    this.speak(cole.name, 'This your camp? You were creeping on our friends down there.', 3, () =>
      this.speak(dane.name, 'We just want to know you\'re going to leave them alone.', 2.8, () => this.ask('Two of the hikers stand at the edge of Ben\'s camp.', [
        { label: 'De-escalate — "You\'re right. I\'ll keep to myself."', fn: () => this.speak('Ben', 'You\'re right. I\'ll keep to myself. There\'s room for everyone up here.', 3, () => { this.outcomes.confrontation = 'deescalated'; this.visitorsLeave('DEESCALATED'); }) },
        { label: 'Leave — walk away without a word', fn: () => { this.outcomes.confrontation = 'left'; this.say('Ben turns and walks into the trees. They shout after him.', 2.8); this.flags.tension = 2; this.visitorsLeave('DEESCALATED'); } },
        { label: this.inv.knife ? 'Threaten — draw the knife' : 'Threaten — "Get off my camp."', fn: () => { this.inv.knifeOut = !!this.inv.knife; this.speak('Ben', 'Get away from my camp.', 2.2, () => this.speak(cole.name, this.inv.knife ? 'Whoa — okay. Okay. We\'re gone. But the rangers will hear about that knife.' : 'Fine. But we\'re telling the rangers about you.', 3.2, () => { this.outcomes.confrontation = 'threatened'; this.alert = 1; this.flags.tension = 3; this.visitorsLeave('DEESCALATED'); this.say('Ranger alert raised — a patrol will be looking for him', 3); })); } },
        { label: 'Fight', fn: () => this.fightBegin([cole, dane]) },
      ])));
  },
  visitorsLeave(next) {
    this.actors.filter(a => a.kind === 'hiker' && a.map === 'campsite').forEach(a => { a.mode = 'leave'; a.path = this.path(this.map, a.x, a.y, 1500, 1120); a.speed = KCFG.npcWalk * 1.3; });
    this.flags.visitors = 'left'; this.phase = 'FREE_EXPLORE'; this.objective('Explore the valley'); this.save();
  },
  // 4b. A fight has consequences: it is a short brawl and it brings the helicopter.
  fightBegin(foes) {
    this.phase = 'FIGHT'; this.fight = { foes, t: 0, hits: 0, hurtT: 0, done: false }; this.objective('FIGHT — Space / tap to swing, or walk away');
    this.say(this.inv.knifeOut ? 'Ben has the knife out. This will not end well.' : 'Fists up.', 2.2); Audio.sfx('growl');
  },
  fightUpdate(dt) {
    const G = Game, b = G.ben, f = this.fight; f.t += dt; f.hurtT = Math.max(0, f.hurtT - dt);
    G.moveBen(dt, KCFG.walk * 0.8, (x, y) => this.can(x, y));
    const near = f.foes.filter(o => dist(o.x, o.y, b.x, b.y) < 120);
    if (Input.fire() && near.length && f.hurtT <= 0) {
      f.hits++; b.pose = 'cast'; b.poseT = 0; Audio.sfx('hit'); const o = near[0]; o.hurt = 0.5; o.x += (o.x - b.x) * 0.15; o.y += (o.y - b.y) * 0.15;
      if (this.inv.knifeOut) { this.flags.knifeUsed = true; G.stats.astral = Math.max(0, G.stats.astral - 15); this.say('The blade catches him. Everyone freezes.', 2.4); f.hits += 2; }
    }
    if (b.pose === 'cast') { b.poseT += dt; if (b.poseT > 0.35) b.pose = 'idle'; }
    for (const o of f.foes) { o.hurt = Math.max(0, (o.hurt || 0) - dt); if (o.hurt <= 0 && dist(o.x, o.y, b.x, b.y) > 60) { const d = dist(o.x, o.y, b.x, b.y); o.x += (b.x - o.x) / d * 80 * dt; o.y += (b.y - o.y) / d * 80 * dt; o.dir = dirFromVec(b.x - o.x, b.y - o.y); o.moving = true; }
      else o.moving = false;
      if (o.hurt <= 0 && dist(o.x, o.y, b.x, b.y) < 70 && Math.random() < dt * 0.9 && f.hurtT <= 0) { f.hurtT = 0.9; b.pose = 'hurt'; b.poseT = 0; G.stats.health = Math.max(0, G.stats.health - 8); Audio.sfx('impact'); this.say('Ben takes a hit', 1.2); } }
    const far = f.foes.every(o => dist(o.x, o.y, b.x, b.y) > 420);
    if (f.hits >= 4 || G.stats.health <= 20 || far) {
      this.fight = null; this.outcomes.confrontation = far ? 'fled-fight' : this.flags.knifeUsed ? 'knife-fight' : 'fight'; this.flags.tension = 4;
      this.say(far ? 'Ben breaks away. Someone is already on a satellite phone.' : 'They back off, bleeding. One of them is on a satellite phone.', 3.2);
      this.visitorsLeave(); this.heliCall();
    }
  },
  // 5. DNLR response
  heliCall() {
    if (this.heli && this.heli.state !== 'gone') return;
    this.phase = 'HELICOPTER_RESPONSE'; this.alert = 2;
    const lz = this.maps.beach.lz; this.heli = { state: 'approach', t: 0, x: lz[0] - 1600, y: lz[1] - 700, lz, rot: 0 };
    this.objective('A helicopter is coming in over the beach'); Audio.sfx('pressure'); this.flags.heliCalled = true; this.save();
  },
  heliUpdate(dt) {
    const h = this.heli; if (!h || h.state === 'gone') return; h.t += dt; h.rot += dt;
    const H = KCFG.heli;
    if (h.state === 'approach') { const k = ease(clamp(h.t / H.approach, 0, 1)); h.x = lerp(h.lz[0] - 1600, h.lz[0], k); h.y = lerp(h.lz[1] - 700, h.lz[1] - 40, k); h.alt = 1; if (h.t > H.approach) { h.state = 'hover'; h.t = 0; } if (this.mapId === 'beach' && h.t < 0.1) this.say('Thump of rotors over the water', 2); }
    else if (h.state === 'hover') { h.alt = 1; if (h.t > H.hover) { h.state = 'landing'; h.t = 0; } }
    else if (h.state === 'landing') { h.alt = 1 - ease(clamp(h.t / H.land, 0, 1)); if (h.t > H.land) { h.state = 'landed'; h.t = 0; this.spawnRangers(); } }
    else if (h.state === 'landed') { h.alt = 0; if (this.mapId === 'beach' && Math.random() < dt * 0.3) this.say('Rotors winding down on the sand', 1.5); }
    if (h.state !== 'landed' && this.mapId !== 'beach' && Math.random() < dt * 0.15) this.say('Helicopter noise echoes off the pali', 1.6);
  },
  spawnRangers() {
    const lz = this.maps.beach.lz; this.rangers = [];
    ['A', 'B', 'C', 'D'].forEach((v, i) => this.rangers.push({ id: 'r' + v, v, map: 'beach', x: lz[0] + (i - 1.5) * 50, y: lz[1] + 60, dir: 4, t: 0, mode: 'pursue', path: null, searchT: 0, alpha: 1, speed: KCFG.rangerRun }));
    this.phase = 'RANGER_CHASE'; this.chase = { t: 0, lastSeen: 0, contactT: 0 }; this.objective('DNLR rangers are on the ground — get away and hide');
    this.say('Four rangers jump out and fan across the beach', 3); Audio.sfx('ingress');
  },
  rangersUpdate(dt) {
    if (!this.chase) return; const G = Game, b = G.ben; this.chase.t += dt;
    let anyContact = false;
    for (const r of this.rangers) {
      r.t += dt; if (r.mode === 'done') continue;
      if (r.mode === 'arrest') continue;
      if (r.stun > 0) { r.stun -= dt; r.moving = false; continue; }
      if (r.map === this.mapId && !this.hidden) { // same map: chase Ben directly
        anyContact = true; this.chase.lastSeen = this.chase.t;
        if (!r.path || r.t - (r.pathT || -9) > 0.6) { r.path = this.path(this.map, r.x, r.y, b.x, b.y); r.pathT = r.t; }
        this.stepAlong(r, dt, r.speed);
        if (dist(r.x, r.y, b.x, b.y) < KCFG.catchR) { this.arrest(r, 'caught'); return; }
      } else if (r.map === this.mapId && this.hidden) { // search the map he hid in, then move on
        r.searchT += dt; const M = this.map;
        if (!r.path || !r.path.length) { const hx = this.hidden.x + (Math.random() - 0.5) * 500, hy = this.hidden.y + (Math.random() - 0.5) * 400; r.path = this.path(M, r.x, r.y, clamp(hx, 40, M.w - 40), clamp(hy, 40, M.h - 40)); }
        this.stepAlong(r, dt, KCFG.rangerWalk); r.searching = true;
        if (r.searchT > KCFG.hideSearch) { r.searchT = 0; r.searching = false; this.rangerLeaveMap(r, M); }
      } else { // other map: move toward Ben's map through portals
        r.searching = false; const M = this.maps[r.map]; const p = this.nextPortal(r.map, this.mapId);
        if (!p) { r.mode = 'done'; continue; }
        if (!r.path || !r.path.length) r.path = this.path(M, r.x, r.y, p.x, p.y);
        this.stepAlong(r, dt, KCFG.rangerRun * 0.9, M);
        if (dist(r.x, r.y, p.x, p.y) < p.r + 10) { const dest = this.maps[p.to[0]], q = this.portalOf(dest, p.to[1]); r.map = p.to[0]; r.x = q.x; r.y = q.y; r.path = null; r.searchT = 0; }
      }
    }
    if (anyContact) this.chase.contactT = this.chase.t;
    if (this.chase.t - this.chase.contactT > KCFG.chaseGiveUp && !this.hidden) this.searchClear();
  },
  rangerLeaveMap(r, M) { const p = M.portals[Math.floor(Math.random() * M.portals.length)]; if (p.to[0] === 'EXIT') return; const dest = this.maps[p.to[0]], q = this.portalOf(dest, p.to[1]); r.map = p.to[0]; r.x = q.x; r.y = q.y; r.path = null; },
  stepAlong(a, dt, speed, M = this.map) {
    if (!a.path || !a.path.length) { a.moving = false; return; }
    const t = a.path[0], dx = t[0] - a.x, dy = t[1] - a.y, d = Math.hypot(dx, dy);
    if (d < 6) { a.path.shift(); return; }
    const st = Math.min(d, speed * dt); a.x += dx / d * st; a.y += dy / d * st; a.dir = dirFromVec(dx, dy); a.moving = true; a.phase = (a.phase || 0) + dt;
  },
  searchClear() { this.chase = null; this.rangers.forEach(r => r.mode = 'done'); this.rangers = []; if (this.heli) this.heli.state = 'gone'; this.alert = 0; this.phase = 'FREE_EXPLORE'; this.outcomes.chase = 'evaded'; this.objective('Explore the valley — the rangers have gone'); this.say('The rotors fade. They\'ve given up — for now.', 3); this.save(); },
  // Hiding rule (strict): only when no pursuing ranger is on the current screen; otherwise immediate arrest.
  tryHide(spot) {
    const G = Game;
    const onScreen = this.rangers.some(r => r.map === this.mapId && r.mode !== 'done' && this.onScreen(r.x, r.y));
    if (this.chase && onScreen) { this.say('They saw him go for the bushes.', 2); this.arrest(this.rangers.find(r => r.map === this.mapId), 'seen-hiding'); return; }
    this.hidden = { x: spot[0], y: spot[1], t: 0 }; G.ben.x = spot[0]; G.ben.y = spot[1] + 10; G.ben.moving = false; G.walkTarget = null;
    this.outcomes.hid = (this.outcomes.hid || 0) + 1; Audio.sfx('bag'); this.objective(this.chase ? 'Hidden — wait for the search to pass' : 'Hidden'); this.phase = this.chase ? 'HIDDEN' : this.phase;
  },
  onScreen(x, y) { const G = Game, [sx, sy] = G.worldToScreen(x, y); return sx > -20 && sy > -20 && sx < G.W + 20 && sy < G.H + 20; },
  hiddenUpdate(dt) {
    const h = this.hidden; h.t += dt; Game.ben.moving = false;
    const here = this.rangers.some(r => r.map === this.mapId && r.mode !== 'done');
    const clear = !this.chase || (!here && h.t > 3) || (this.chase.t - this.chase.contactT > KCFG.chaseGiveUp);
    if (clear && h.t > 2.5) { this.hidden = null; if (this.chase) { this.outcomes.hideSuccess = true; this.say('The search has moved on. Ben crawls out.', 2.6); if (this.chase.t - this.chase.contactT > KCFG.chaseGiveUp) this.searchClear(); else { this.phase = 'RANGER_CHASE'; this.objective('Keep moving — they\'re still out there'); } } else this.phase = 'FREE_EXPLORE'; return; }
    if (!this.chase && Input.action()) { this.hidden = null; }
  },
  arrest(r, how) {
    const G = Game; if (this.phase === 'ARRESTED') return;
    this.phase = 'ARRESTED'; this.hidden = null; this.outcomes.chase = how === 'seen-hiding' ? 'arrested-hiding' : 'arrested';
    if (r) { r.mode = 'arrest'; r.x = G.ben.x - 30; r.y = G.ben.y; }
    this.arrestT = 0; G.ben.moving = false; G.walkTarget = null; this.objective('');
    this.say(how === 'seen-hiding' ? 'A ranger was right there. Cuffs.' : 'Caught. Cuffs.', 3); Audio.sfx('horn');
  },
  arrestedUpdate(dt) {
    this.arrestT += dt;
    if (this.arrestT > 3.2 && !this.flags.expelled) { this.flags.expelled = true; this.trailheadExpulsion(); }
  },
  // 5b. Trailhead checkpoint: no free helicopter ride.
  trailheadExpulsion() {
    const G = Game; this.rangers = []; this.chase = null; if (this.heli) this.heli.state = 'gone';
    this.phase = 'TRAILHEAD_EXPULSION'; this.night = false; this.clock = 8.5; this.flags.debugNight = false;
    const th = this.maps['red-dirt-hill'].trailhead; this.enterMap('red-dirt-hill', null, th); G.ben.dir = 2;
    const ranger = { id: 'rX', v: 'A', map: 'red-dirt-hill', x: th[0] - 70, y: th[1] + 10, dir: 2, t: 0, mode: 'arrest', alpha: 1 }; this.rangers = [ranger];
    this.speak('Ranger', "Walk out of here and don't come back ever. You've been charged with public nuisance and trespassing.", 5, () => {
      this.phase = 'HIKE_OUT'; this.checkpoint = { map: 'red-dirt-hill', x: th[0], y: th[1] }; this.rangers = [];
      this.objective('Hike out — up Red Dirt Hill to the trail, then Crawler\'s Ledge'); this.outcomes.expelled = true; this.save();
    });
  },

  /* ------------------------------------------------ 6. jet-ski arrival, camp raid, fire, knife */
  storyBeats(dt) {
    const G = Game;
    // hikers wander toward Ben's camp a while after the beach scene
    if (this.outcomes.social && !this.flags.visitors && ((this.clock - this.flags.socialAt + 24) % 24) > 0.9 && this.mapId !== 'beach') {
      this.flags.visitors = 'coming'; const C = this.maps.campsite;
      ['h1', 'h5', 'h6'].forEach((id, i) => { const a = this.actors.find(x => x.id === id); a.map = 'campsite'; a.pack = false; a.x = 1300 - i * 40; a.y = 900 + i * 30; a.mode = 'goto'; a.path = null; a.target = [1420 + i * 60, 800 + (i % 2) * 40]; });
      ['h0', 'h2', 'h3', 'h4'].forEach(id => { const a = this.actors.find(x => x.id === id); a.pack = false; a.mode = 'wander'; });
    }
    if (this.flags.visitors === 'coming' && this.actors.filter(a => ['h1', 'h5', 'h6'].includes(a.id)).every(a => a.mode === 'idle' || a.map !== this.mapId)) { this.flags.visitors = 'arrived'; this.actors.filter(a => ['h1', 'h5', 'h6'].includes(a.id)).forEach(a => { if (a.mode === 'goto' && a.map !== this.mapId) { a.mode = 'idle'; a.x = a.target[0]; a.y = a.target[1]; } }); if (this.mapId === 'campsite') this.say('Voices at the camp — three of the hikers are standing by the tent', 3); }
    if (this.flags.visitors === 'arrived' && this.mapId === 'campsite' && !this.outcomes.confrontation && !this.choice && !this.dialog && this.phase === 'FREE_EXPLORE') {
      const cole = this.actors.find(a => a.id === 'h5'); if (dist(cole.x, cole.y, G.ben.x, G.ben.y) < 150) this.campConfrontation();
    }
    // jet-ski group: arrives once the visitors are dealt with (or after enough time), when Ben is on the beach or at camp
    const ready = (this.outcomes.confrontation || ((this.clock - (this.flags.socialAt || 0) + 24) % 24) > 3) && !this.flags.raid && !this.chase && this.phase === 'FREE_EXPLORE';
    if (ready && (this.mapId === 'beach' || this.mapId === 'campsite')) this.raidBegin();
    if (this.flags.raid === 'toCamp' && this.actors.filter(a => a.kind === 'local').every(a => a.mode === 'idle' && a.map === 'campsite')) {
      this.flags.raid = 'atCamp';
      if (this.mapId !== 'campsite') { this.campFire(); this.say('Smoke rising over the trees — from the direction of camp', 3.5); }
      else this.say('Four people are standing around Ben\'s tent. One of them has a lighter out.', 3.5);
    }
  },
  raidBegin() {
    this.flags.raid = 'arriving'; const B = this.maps.beach;
    this.skis.forEach((s, i) => Object.assign(s, { map: 'beach', x: B.skiSea[i][0], y: B.skiSea[i][1], tx: B.skiShore[i][0], ty: B.skiShore[i][1], mode: 'run', t: 0 }));
    this.actors.filter(a => a.kind === 'local').forEach((a, i) => { a.map = 'beach'; a.mode = 'riding'; a.skiRef = this.skis[a.ski === 'r' ? 0 : 1]; });
    if (this.mapId === 'beach') { this.say('Two jet skis carving in from the reef', 3); Audio.carPass(0.4, 0.6, 'truck'); }
    this.objective('Explore the valley');
  },
  skisUpdate(dt) {
    for (const s of this.skis) {
      if (s.mode !== 'run') continue; s.t += dt; const d = dist(s.x, s.y, s.tx, s.ty);
      if (d < 8) { s.mode = 'beached'; continue; } const sp = Math.min(d, 260 * dt); s.x += (s.tx - s.x) / d * sp; s.y += (s.ty - s.y) / d * sp;
    }
    if (this.flags.raid === 'arriving' && this.skis.every(s => s.mode === 'beached')) {
      this.flags.raid = 'toCamp'; const C = this.maps.campsite;
      this.actors.filter(a => a.kind === 'local').forEach((a, i) => { a.mode = 'goto'; a.skiRef = null; a.x = a.ski === 'r' ? 900 : 1000; a.y = 740 + i * 10; a.map = 'beach'; a.viaPortal = { from: 'beach', to: 'campsite', dest: [1380 + i * 70, 760 + (i % 2) * 50] }; a.target = [620, 60]; a.path = null; });
      if (this.mapId === 'beach') this.say('They pull the skis up the sand and head for the trail', 3);
    }
  },
  raidConfrontation() {
    const kai = this.actors.find(a => a.id === 'kai'), noa = this.actors.find(a => a.id === 'noa');
    this.speak(kai.name, 'This your camp, brah? You don\'t belong up here. Nobody asked you to stay.', 3.4, () =>
      this.speak(noa.name, 'Pack it up. Today.', 2, () => this.ask('Four of them, one lighter. Ben\'s whole life is in that tent.', [
        { label: 'Back off — "Take it easy. I\'ll go."', fn: () => this.speak('Ben', 'Take it easy. I\'ll go.', 2, () => this.speak(kai.name, 'You\'ll go now. We\'ll make sure of it.', 2.4, () => { this.outcomes.raid = 'backed-off'; this.campFire(); })) },
        { label: 'Run — get clear of the camp', fn: () => { this.outcomes.raid = 'ran'; this.say('Ben backs into the trees. Behind him, a whoomp of fuel catching.', 3); this.campFire(); Game.ben.x -= 120; } },
        { label: this.inv.knife ? 'Draw the knife — "Get away from my tent."' : 'Stand your ground', fn: () => { this.inv.knifeOut = !!this.inv.knife; this.speak('Ben', 'Get away from my tent.', 2, () => this.speak(kai.name, this.inv.knife ? 'You pull a knife on us? Okay. Okay… this ain\'t over, King.' : 'Big words.', 3, () => {
            if (this.inv.knife) { this.outcomes.raid = 'knife'; this.flags.raidReturn = true; this.localsLeave(); this.say('They back off toward the beach. That won\'t be the end of it.', 3.2); } else { this.outcomes.raid = 'stood'; this.campFire(); } })); } },
      ])));
  },
  localsLeave() { this.actors.filter(a => a.kind === 'local').forEach(a => { a.mode = 'leave'; a.path = this.path(this.map, a.x, a.y, 1500, 1120); }); this.flags.raid = 'done'; },
  campFire() {
    if (this.camp.state !== 'intact') return; this.camp.state = 'burning'; this.camp.fireT = 0; this.flags.raid = 'done';
    this.actors.filter(a => a.kind === 'local').forEach(a => { a.mode = 'leave'; if (a.map === 'campsite') a.path = this.path(this.maps.campsite, a.x, a.y, 1500, 1120); else a.gone = true; });
    Audio.sfx('pressure'); Audio.sfx('growl'); if (this.mapId === 'campsite') this.say('The tent goes up in a rush of flame', 3);
    this.outcomes.fire = true; this.save();
  },
  fireUpdate(dt) {
    const c = this.camp; if (c.state !== 'burning') return; c.fireT += dt;
    const F = KCFG.fire;
    if (c.fireT > F.burned) { c.state = 'burned'; this.phase = this.phase === 'FREE_EXPLORE' ? 'AFTERMATH' : this.phase; this.objective('Aftermath — the camp is gone'); this.say('Nothing left but the frame and a smell of burnt nylon.', 3.5); this.save(); setTimeout(() => { if (this.phase === 'AFTERMATH') this.phase = 'FREE_EXPLORE'; }, 4000); }
    if (this.mapId === 'campsite') { const t = this.map.camp.tent; if (Math.random() < dt * 5) this.spawnFx(c.fireT < F.gray ? 'gsmoke' : 'bsmoke', t[0] + (Math.random() - 0.5) * 60, t[1] - 40, { h: 70 + Math.random() * 60, vy: -40, dur: 1.4, alpha: 0.85 }); }
    // fire is dangerous: standing in it burns
    if (this.mapId === 'campsite' && dist(Game.ben.x, Game.ben.y, this.map.camp.tent[0], this.map.camp.tent[1] + 30) < 70 && c.fireT > F.ignite) { Game.stats.health = Math.max(0, Game.stats.health - 20 * dt); if (Math.random() < dt * 2) this.say('Too hot — back away!', 1); }
  },

  /* ------------------------------------------------ NPC movement */
  actorsUpdate(dt) {
    this.skisUpdate(dt);
    for (const a of this.actors) {
      if (a.gone) continue; a.t += dt;
      if (a.mode === 'riding' && a.skiRef) { a.x = a.skiRef.x; a.y = a.skiRef.y - 10; continue; }
      if (a.map !== this.mapId && a.mode !== 'goto') continue;
      const M = this.maps[a.map]; if (!M) continue;
      if (a.mode === 'goto') {
        if (!a.path) a.path = this.path(M, a.x, a.y, a.target[0], a.target[1]);
        this.stepAlong(a, dt, a.speed, M);
        if (!a.path.length) { if (a.viaPortal && a.map === a.viaPortal.from) { a.map = a.viaPortal.to; const q = this.portalOf(this.maps[a.map], 'S'); a.x = q.x; a.y = q.y - 40; a.target = a.viaPortal.dest; a.viaPortal = null; a.path = null; } else { a.mode = 'idle'; a.moving = false; } }
      } else if (a.mode === 'leave') { this.stepAlong(a, dt, a.speed * 1.2, M); if (!a.path || !a.path.length) { a.gone = true; } }
      else if (a.mode === 'wander') { a.wt = (a.wt || 0) - dt; if (a.wt <= 0) { a.wt = 3 + Math.random() * 5; a.path = this.path(M, a.x, a.y, clamp(a.x + (Math.random() - 0.5) * 300, 60, M.w - 60), clamp(a.y + (Math.random() - 0.5) * 200, 60, M.h - 60)); } this.stepAlong(a, dt, a.speed * 0.6, M); }
      else { a.moving = false; if (a.map === this.mapId && dist(a.x, a.y, Game.ben.x, Game.ben.y) < 140) a.dir = dirFromVec(Game.ben.x - a.x, Game.ben.y - a.y); }
    }
  },

  /* ------------------------------------------------ 7. night + supernatural */
  setNight(n) { this.night = n; if (n) { this.phase = this.phase === 'FREE_EXPLORE' ? 'NIGHTFALL' : this.phase; this.say('Night comes down fast in the valley', 3); this.nightSpawns(); setTimeout(() => { if (this.phase === 'NIGHTFALL') this.phase = 'SUPERNATURAL_ACTIVITY'; }, 3000); }
    else { this.menehune = []; this.marchers = null; if (this.phase === 'SUPERNATURAL_ACTIVITY' || this.phase === 'NIGHTFALL') this.phase = 'FREE_EXPLORE'; this.say('First light on the pali', 2.5); }
    Audio.ambience({ evening: n ? 0.35 : 0, morning: n ? 0 : 0.25, street: 0.08 }, 2); this.save(); },
  nightSpawns() {
    const M = this.map; if (!M) return; this.menehune = [];
    if (['valley', 'campsite', 'river-jungle', 'rear-cliff-clearing'].includes(this.mapId)) for (let i = 0; i < KCFG.menehune; i++) this.spawnMenehune();
    if (['valley', 'beach'].includes(this.mapId) && !this.marchers) this.spawnMarchers();
  },
  spawnMenehune() {
    const M = this.map, b = Game.ben; let x, y, tries = 0;
    do { const c = M.corridors[Math.floor(Math.random() * M.corridors.length)], p = c.pts[Math.floor(Math.random() * c.pts.length)]; x = p[0] + (Math.random() - 0.5) * 160; y = p[1] + (Math.random() - 0.5) * 160; tries++; } while (tries < 20 && dist(x, y, b.x, b.y) < 420);
    this.menehune.push({ x, y, t: 0, mode: 'watch', alpha: 0, facing: b.x > x ? 1 : -1, wt: 2 + Math.random() * 4 });
  },
  spawnMarchers() {
    const M = this.map, c = M.corridors[0], line = [];
    for (let i = 0; i < KCFG.marchers; i++) line.push({ x: c.pts[0][0], y: c.pts[0][1], seg: 0, u: -i * 0.35, t: i * 0.3, alpha: 0 });
    this.marchers = { map: this.mapId, line, c, t: 0, warned: false, passedThrough: false };
  },
  nightUpdate(dt) {
    const b = Game.ben;
    for (const m of this.menehune) {
      m.t += dt; const d = dist(m.x, m.y, b.x, b.y);
      if (m.mode === 'watch') { m.alpha = Math.min(0.9, m.alpha + dt * 0.5); m.wt -= dt; if (d < 260 || m.wt <= 0) { m.mode = 'move'; m.wt = 1 + Math.random() * 2; m.facing = Math.random() < 0.5 ? 1 : -1; } }
      else if (m.mode === 'move') { m.x += m.facing * 60 * dt; m.y += Math.sin(m.t * 3) * 20 * dt; m.wt -= dt; if (d < 170) { m.mode = 'vanish'; m.t = 0; } else if (m.wt <= 0) { m.mode = 'watch'; m.wt = 2 + Math.random() * 4; } }
      else if (m.mode === 'vanish') { if (m.t > 0.9) { m.dead = true; this.outcomes.menehune = (this.outcomes.menehune || 0) + 1; } }
    }
    this.menehune = this.menehune.filter(m => !m.dead);
    if (this.menehune.length < KCFG.menehune && Math.random() < dt * 0.15 && ['valley', 'campsite', 'river-jungle', 'rear-cliff-clearing'].includes(this.mapId)) this.spawnMenehune();
    const P = this.marchers;
    if (P && P.map === this.mapId && P.veer) { // pushed: they recoil and veer off the path, fading into the dark
      P.veer.t += dt; for (const m of P.line) { m.t += dt; m.x += P.veer.ax * 90 * dt; m.y -= 30 * dt; m.alpha = Math.max(0, m.alpha - dt / 2.4); }
      if (P.veer.t > 2.6) this.marchers = null;
    } else if (P && P.map === this.mapId) {
      P.t += dt; const pts = P.c.pts;
      for (const m of P.line) {
        m.t += dt; m.u += dt * 0.32; m.alpha = Math.min(1, m.alpha + dt * 0.4);
        let u = Math.max(0, m.u); let seg = Math.floor(u); const f = u - seg;
        if (seg >= pts.length - 1) { seg = pts.length - 2; m.done = true; }
        m.x = lerp(pts[seg][0], pts[seg + 1][0], f); m.y = lerp(pts[seg][1], pts[seg + 1][1], f); m.dirx = pts[seg + 1][0] - pts[seg][0];
        const d = dist(m.x, m.y, b.x, b.y);
        if (d < 40 && !(this.flags.kneeling > 0) && !P.passedThrough) { P.passedThrough = true; Game.stats.astral = Math.max(0, Game.stats.astral - 30); Game.stats.health = Math.max(0, Game.stats.health - 10); b.pose = 'hurt'; b.poseT = 0; Audio.sfx('drain'); this.say('The procession passes straight through him. Cold to the bone.', 3.2); this.outcomes.marchers = 'passed-through'; }
        else if (d < 40 && this.flags.kneeling > 0 && !this.outcomes.marchers) { this.outcomes.marchers = 'knelt'; this.say('Torchlight passes over his bowed head. They move on.', 3); }
      }
      if (!P.warned && P.line.some(m => dist(m.x, m.y, b.x, b.y) < 380)) { P.warned = true; this.say('Drums. Torches in a line along the path. Do not stand in their way.', 3.6); Audio.sfx('pulse'); }
      if (P.line.every(m => m.done)) this.marchers = null;
    }
  },
  // Kamapuaʻa: mist -> six materialisation stages -> combat (mist volumes, awakened vines, spear). Dignified, never comic.
  kamaBegin(at) {
    const K = at || this.map.kama || [Game.ben.x + 220, Game.ben.y - 40]; this.kama = { map: this.mapId, x: K[0], y: K[1], t: 0, stage: -1, mode: 'mist', vines: [], mists: [], mistT: 0, vineT: 0, attackT: 0, hits: 0, encT: 0, invuln: 0, warn: 0 };
    this.prevPhase = this.phase; this.phase = 'KAMAPUAA_ENCOUNTER'; this.say('The mist ahead gathers itself into a shape', 3.4); Audio.sfx('pressure'); Audio.ambience({ astral: 0.4, evening: 0.2 }, 2);
    this.spawnMist(K[0], K[1], 320);
  },
  spawnMist(x, y, size) { this.kama.mists.push({ x, y, t: 0, size, dur: 3.2 }); },
  kamaUpdate(dt) {
    const k = this.kama, b = Game.ben, KC = KCFG.kama; k.t += dt; k.encT += dt;
    if (this.mapId !== k.map) { if (k.mode === 'combat' || k.mode === 'materialise') { this.kama = null; this.phase = this.prevPhase || 'FREE_EXPLORE'; } else this.kama = null; return; } // leaving resets him; he waits on the trail
    if (k.mode === 'mist') { if (k.t > 2.5) { k.mode = 'materialise'; k.t = 0; k.stage = 0; Audio.sfx('growl'); } }
    else if (k.mode === 'materialise') { const st = Math.min(5, Math.floor(k.t / KC.stage)); if (st !== k.stage) { k.stage = st; if (st === 1) this.say('Two eyes open in the mist', 2.2); if (st === 5) { this.say('Kamapuaʻa. The boar-god of the valley stands before him.', 3.5); } } if (k.t > 6 * KC.stage) { k.mode = 'combat'; k.t = 0; this.objective('Kamapuaʻa — push him back 5 times (Space / FIRE)'); this.say('Push him back with your astral force — Space, or tap him', 3); } }
    else if (k.mode === 'combat') {
      k.mistT += dt; k.vineT += dt; k.attackT += dt;
      if (k.mistT > KC.mistEvery) { k.mistT = 0; this.spawnMist(b.x + (Math.random() - 0.5) * 300, b.y + (Math.random() - 0.5) * 200, 260); }
      if (k.vineT > KC.vineEvery && k.vines.filter(v => !v.dead).length < 3) { k.vineT = 0; const a = Math.random() * TAU; k.vines.push({ x: b.x + Math.cos(a) * 220, y: b.y + Math.sin(a) * 160, t: 0, mode: 'emerge', hp: 2 }); Audio.sfx('distant'); }
      k.invuln = Math.max(0, k.invuln - dt);
      // telegraphed spear: he flares for spearWarn seconds, then strikes if Ben is still in reach
      if (!k.warn && k.attackT > KC.spearEvery) { k.warn = KC.spearWarn; Audio.sfx('growl'); }
      if (k.warn > 0) { k.warn -= dt; if (k.warn <= 0) { k.warn = 0; k.attackT = 0; k.attack = 0.66; Audio.sfx('lunge'); if (dist(k.x, k.y, b.x, b.y) < KC.spearReach) { Game.stats.health = Math.max(0, Game.stats.health - KC.spearDrain); b.pose = 'hurt'; b.poseT = 0; this.say('The spear haft catches Ben across the ribs', 2); } } }
      if (k.attack > 0) k.attack -= dt;
      if (k.recoil > 0) { k.recoil -= dt; const d0 = dist(k.x, k.y, b.x, b.y) || 1; k.x += (k.x - b.x) / d0 * 180 * dt; k.y += (k.y - b.y) / d0 * 180 * dt; }
      // he circles slowly, keeps distance
      const d = dist(k.x, k.y, b.x, b.y) || 1; const want = 200; k.x += ((b.x - k.x) / d) * (d - want) * 0.4 * dt; k.y += ((b.y - k.y) / d) * (d - want) * 0.4 * dt;
      for (const v of k.vines) {
        if (v.dead) continue; v.t += dt; const dv = dist(v.x, v.y, b.x, b.y);
        if (v.mode === 'emerge' && v.t > 0.5) { v.mode = 'crawl'; v.t = 0; }
        else if (v.mode === 'crawl') { if (dv > 50) { v.x += (b.x - v.x) / dv * 70 * dt; v.y += (b.y - v.y) / dv * 70 * dt; } else { v.mode = 'grab'; v.t = 0; this.flags.grabbed = 1.8; this.say('A vine coils round his ankle!', 1.8); } }
        else if (v.mode === 'grab') { if (v.t > 1.8) { v.mode = 'recoil'; v.t = 0; } }
        else if (v.mode === 'recoil') { if (v.t > 0.5) { v.mode = 'crawl'; v.t = 0; } }
        else if (v.mode === 'sever') { if (v.t > 0.5) v.dead = true; }
      }
      if (this.flags.grabbed > 0) { this.flags.grabbed -= dt; b.moving = false; }
      for (const m of k.mists) { m.t += dt; if (m.t > 1 && m.t < m.dur && dist(m.x, m.y, b.x, b.y) < m.size * 0.4) { Game.stats.astral = Math.max(0, Game.stats.astral - 6 * dt); } }
      k.mists = k.mists.filter(m => m.t < m.dur);
      if (Game.stats.health <= 0) { Game.triggerGameOver('Kamapuaʻa'); return; }
      if (k.hits >= KC.hitsToYield) this.kamaEnd('yielded');
    } else if (k.mode === 'dissolve') { if (k.t > 6 * KC.stage) { this.kama = null; } }
  },
  kamaEnd(how) {
    const k = this.kama; this.outcomes.kamapuaa = how; this.flags.afterKama = true;
    this.say('Kamapuaʻa lowers his spear. He looks at Ben a long moment, then the mist takes him back.', 4.5); k.mode = 'dissolve'; k.t = 0; k.vines.forEach(v => v.dead = true); k.mists = [];
    Audio.sfx('victory'); Audio.ambience({ astral: 0, evening: 0.35 }, 2);
    this.phase = this.prevPhase === 'HIKE_OUT' ? 'HIKE_OUT' : 'FREE_EXPLORE'; this.objective('Follow the trail west to Crawler\'s Ledge');
    if (this.mapId === 'escape-trail') setTimeout(() => { if (this.night) { this.flags.debugNight = true; this.clock = 6.2; this.setNight(false); } }, 4500); // first light for the ledge
    this.save();
  },
  // Ben's astral push in Kalalau (Space / F / FIRE button / tap on a spirit): only the spirit world answers to it
  pushTargets() {
    const b = Game.ben, list = [], k = this.kama;
    if (k && k.mode === 'combat' && k.map === this.mapId) list.push({ x: k.x, y: k.y - 110, kind: 'kama', ref: k });
    if (k) for (const v of k.vines) if (!v.dead && v.mode !== 'emerge' && v.mode !== 'sever') list.push({ x: v.x, y: v.y - 20, kind: 'vine', ref: v });
    if (this.marchers && this.marchers.map === this.mapId && !this.marchers.veer) for (const m of this.marchers.line) if (m.alpha > 0.3) list.push({ x: m.x, y: m.y - 50, kind: 'marcher', ref: m });
    return list.filter(t => dist(t.x, t.y, b.x, b.y - 30) < KCFG.push.range);
  },
  pushAt(t) {
    const G = Game, b = G.ben, P = KCFG.push; if ((this.pushCd || 0) > 0) return false;
    if (G.stats.astral < P.cost) { this.say('No astral energy left', 1.2); Audio.sfx('empty'); return false; }
    G.stats.astral -= P.cost; this.pushCd = P.cooldown; b.pose = 'cast'; b.poseT = 0; b.dir = dirFromVec(t.x - b.x, t.y - b.y); Audio.sfx('launch');
    const hx = b.x, hy = b.y - 34, a = Math.atan2(t.y - hy, t.x - hx);
    (this.pushes = this.pushes || []).push({ x: hx, y: hy, a, t: 0, target: t, dist: Math.hypot(t.x - hx, t.y - hy) }); return true;
  },
  pushUpdate(dt) {
    this.pushCd = Math.max(0, (this.pushCd || 0) - dt);
    if (Input.pressed.has('Space') || Input.pressed.has('KeyF') || Input.fireTap) { const T = this.pushTargets(); const b = Game.ben; T.sort((p, q) => (p.kind === 'kama' ? -1 : 0) - (q.kind === 'kama' ? -1 : 0) || dist(p.x, p.y, b.x, b.y) - dist(q.x, q.y, b.x, b.y)); if (T.length) this.pushAt(T[0]); }
    if (!this.pushes) return;
    for (const w of this.pushes) {
      w.t += dt; const d = w.t * KCFG.push.speed; w.x = Game.ben.x + Math.cos(w.a) * Math.min(d, w.dist); w.y = Game.ben.y - 34 + Math.sin(w.a) * Math.min(d, w.dist);
      if (d >= w.dist && !w.hit) { w.hit = true; this.pushHit(w.target); }
    }
    this.pushes = this.pushes.filter(w => w.t < w.dist / KCFG.push.speed + 0.2);
  },
  pushHit(t) {
    const G = Game; G.spawnFx('impact', t.x, t.y, { h: 110, dur: 0.35 });
    if (t.kind === 'kama') { const k = t.ref; if (k.invuln > 0 || k.mode !== 'combat') return; k.hits++; k.invuln = KCFG.kama.invuln; k.recoil = 0.35; k.warn = 0; k.attackT = 0; Audio.sfx('hit'); Audio.sfx('fracture'); this.outcomes.kamaHits = k.hits;
      this.say(['He staggers back', 'The boar-god snorts, shakes it off', 'He drops to one knee — and rises', 'Mist bleeds from him', 'One more…'][Math.min(k.hits - 1, 4)], 1.6); }
    else if (t.kind === 'vine') { const v = t.ref; v.hp = 0; v.mode = 'sever'; v.t = 0; this.flags.grabbed = 0; this.outcomes.vinesCut = (this.outcomes.vinesCut || 0) + 1; Audio.sfx('dissolve'); }
    else if (t.kind === 'marcher') { const P = this.marchers; if (!P || P.veer) return; P.veer = { t: 0, ax: Math.sign(t.x - G.ben.x) || 1 }; this.outcomes.marchers = 'repelled'; Audio.sfx('growl'); this.say('The procession recoils — and turns away into the dark', 3); }
  },

  /* ------------------------------------------------ 8. Crawler's Ledge wind */
  ledgeEnter() {
    const c = this.map.corridors[0]; this.ledge = { pts: c.pts, hw: c.w, gust: null, next: 3.5, difficulty: 0, t: 0, falls: 0 };
    this.checkpoint = { map: 'crawlers-ledge', x: Game.ben.x, y: Game.ben.y }; this.objective('Crawler\'s Ledge — when the wind rises, hold RIGHT into the cliff wall'); this.say('The cliff is on the right. The drop is on the left. Wind comes off the sea in gusts.', 4);
  },
  ledgeSigned(x, y) { // signed offset from the trail centreline: + toward the cliff wall (screen-right / inland), - toward the drop
    const P = this.ledge.pts; let best = 1e9, s = 0, ti = 0, nx = 0, ny = 0;
    for (let i = 0; i + 1 < P.length; i++) { const a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1; let t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2; t = clamp(t, 0, 1); const px = a[0] + dx * t, py = a[1] + dy * t, d = Math.hypot(x - px, y - py); if (d < best) { best = d; const l = Math.sqrt(l2); nx = dy / l; ny = -dx / l; /* right-hand normal (toward wall: +x,-y for a trail heading SE) */ s = (x - px) * nx + (y - py) * ny; ti = i + t; } }
    if (nx < 0) { nx = -nx; ny = -ny; s = -s; } // orient normal toward +x (the inland side)
    return { s, nx, ny, ti };
  },
  ledgeUpdate(dt) {
    const L = this.ledge, W = KCFG.wind, b = Game.ben; L.t += dt;
    const sd = this.ledgeSigned(b.x, b.y);
    const sheltered = sd.s > L.hw - W.shelter && Input.move().x > 0.3;
    L.sheltered = sheltered; L.offset = sd.s;
    // checkpoints along the trail
    for (const cp of this.map.ledge.checkpoints) if (dist(b.x, b.y, cp[0], cp[1]) < 60 && (!this.checkpoint || this.checkpoint.x !== cp[0])) { this.checkpoint = { map: 'crawlers-ledge', x: cp[0], y: cp[1] }; this.say('Safe footing', 1.2); }
    if (!L.gust) { L.next -= dt; if (L.next <= 0) { const k = Math.pow(W.scaleTelegraph, L.difficulty); L.gust = { phase: 'cue', t: 0, tele: W.telegraph * k, react: W.react * k, dur: lerp(W.gust[0], W.gust[1], Math.random()), force: lerp(W.force[0], W.force[1], Math.random()) * Math.pow(W.scaleForce, L.difficulty) }; Audio.sfx('distant'); this.say('Wind rising —', 1); } return; }
    const g = L.gust; g.t += dt;
    if (g.phase === 'cue') { if (g.t > g.tele) { g.phase = 'react'; g.t = 0; this.say('BRACE RIGHT — into the wall!', 1.4); Audio.sfx('pressure'); } }
    else if (g.phase === 'react') { if (g.t > g.react) { g.phase = 'gust'; g.t = 0; Audio.sfx('growl'); } }
    else if (g.phase === 'gust') {
      if (sheltered) { b.pose = 'brace'; b.poseT = 0; b.moving = false; }
      else { // pushed toward the drop (-normal)
        const f = g.force * dt; const nx = b.x - sd.nx * f, ny = b.y - sd.ny * f; b.x = nx; b.y = ny; b.pose = 'hurt'; b.poseT = 0;
        const s2 = this.ledgeSigned(b.x, b.y).s;
        if (s2 < -L.hw - W.fallMargin) { this.ledgeFall(); return; }
      }
      if (g.t > g.dur) { g.phase = 'done'; g.t = 0; b.pose = 'idle'; if (sd.s < -L.hw + 6) this.say('Right at the edge — recover!', 1.4); }
    } else if (g.phase === 'done') { if (g.t > 0.8) { L.gust = null; L.next = lerp(W.interval[0], W.interval[1], Math.random()); L.difficulty++; L.gusts = (L.gusts || 0) + 1; } }
  },
  ledgeFall() {
    const L = this.ledge, b = Game.ben, cp = this.checkpoint; L.falls++; this.outcomes.falls = L.falls; L.gust = null; L.next = 4; L.difficulty = Math.max(0, L.difficulty - 1);
    this.say('He goes over the edge — and claws back to the last safe stretch of trail.', 3.4); Audio.sfx('impact'); Game.stats.health = Math.max(10, Game.stats.health - 15);
    b.x = cp.x; b.y = cp.y; b.pose = 'hurt'; b.poseT = 0; Game.walkTarget = null; Game.cam.x = b.x; Game.cam.y = b.y;
  },

  /* ------------------------------------------------ fx */
  sparkle(x, y, n = 20) { Game.sparkle(x, y, n, [255, 210, 110]); },
  // the guinea pig came along as his guide: it keeps close, and with a carrot in it, it goes for rangers, vines and anyone in a fight
  pigUpdate(dt) {
    const q = this.pig, b = Game.ben, G = Game; if (!q || this.hidden) return; q.t += dt; q.cool = Math.max(0, q.cool - dt);
    let threat = null, td = CFG.pigGuardRange;
    const consider = (x, y, r, hit) => { const d = dist(x, y, b.x, b.y); if (d < td) { td = d; threat = { x, y, r, hit }; } };
    if (this.chase) for (const r of this.rangers) if (r.map === this.mapId && r.mode === 'pursue' && !(r.stun > 0)) consider(r.x, r.y - 10, 40, () => { r.stun = 1.4; r.x += (r.x - b.x) * 0.2; r.y += (r.y - b.y) * 0.2; this.say('The guinea pig trips a ranger!', 1.5); });
    if (this.kama) for (const v of this.kama.vines) if (!v.dead && v.mode !== 'emerge' && v.mode !== 'sever') consider(v.x, v.y, 44, () => { v.hp--; if (v.hp <= 0) { v.mode = 'sever'; v.t = 0; this.flags.grabbed = 0; this.outcomes.vinesCut = (this.outcomes.vinesCut || 0) + 1; } });
    if (this.fight) for (const o of this.fight.foes) if (!(o.hurt > 0)) consider(o.x, o.y - 10, 40, () => { o.hurt = 0.8; this.fight.hits++; });
    if (threat && !pigFuel.call(G, q)) threat = null;
    if (threat) {
      q.orbit = (q.orbit || 0) + dt * CFG.pigOrbitSpeed; q.moving = true; q.guarding = true;
      const ang = Math.atan2(threat.y - b.y, threat.x - b.x), rel = q.orbit - ang, R = CFG.pigOrbitRadius + Math.max(0, Math.cos(rel)) * Math.max(0, Math.min(td - 20, 90));
      const nx = b.x + Math.cos(q.orbit) * R, ny = b.y + Math.sin(q.orbit) * R * 0.7; q.facing = nx > q.x ? 1 : -1; q.x = nx; q.y = ny;
      if (q.cool <= 0 && dist(q.x, q.y, threat.x, threat.y) < threat.r) { q.cool = 1.1; threat.hit(); G.inv.pigCharges--; this.sparkle(q.x, q.y - 20, 14); Audio.sfx('squeak'); G.pigHits = (G.pigHits || 0) + 1; }
      return;
    }
    q.guarding = false;
    const a = b.dir * TAU / 8, tx = b.x - Math.sin(a) * 30 + 12, ty = b.y + Math.cos(a) * 30 + 6, dx = tx - q.x, dy = ty - q.y, d = Math.hypot(dx, dy);
    if (d > 420) { q.x = tx; q.y = ty; q.moving = false; return; }
    if (d > 10) { const sp = Math.min(d, Math.max(KCFG.run * 1.15, d * 3) * dt); q.x += dx / d * sp; q.y += dy / d * sp; q.moving = true; if (Math.abs(dx) > 2) q.facing = dx > 0 ? 1 : -1; } else { q.moving = false; q.facing = b.x > q.x ? 1 : -1; }
  },
  spawnFx(anim, x, y, o = {}) { const a = Assets.anim('kfx', anim); if (!a) return; this.fx.push(Object.assign({ anim, x, y, t: 0, dur: o.dur || a.duration || a.frame_duration * a.frames.length, h: 60, vx: 0, vy: 0, alpha: 1, add: true }, o)); },
  fxUpdate(dt) { for (const f of this.fx) { f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; } this.fx = this.fx.filter(f => f.t < f.dur); },

  /* ------------------------------------------------ debug */
  debugKeys() {
    const P = Input.pressed;
    if (P.has('KeyT')) { this.flags.debugNight = true; this.setNight(!this.night); }
    if (P.has('KeyR')) { if (!this.chase) { this.spawnRangers(); this.rangers.forEach(r => { r.map = this.mapId; r.x = Game.ben.x + 500; r.y = Game.ben.y; }); } else this.searchClear(); }
    if (P.has('KeyH')) this.heliCall();
    if (P.has('KeyF')) this.campFire();
    if (P.has('KeyG')) { if (!this.kama) { if (!this.night) { this.flags.debugNight = true; this.setNight(true); } this.outcomes.kamapuaa = undefined; this.kamaBegin([Game.ben.x + 220, Game.ben.y - 30]); } else if (this.kama.mode === 'materialise') this.kama.t += KCFG.kama.stage; }
    if (P.has('KeyW') && this.ledge) { this.ledge.difficulty = (this.ledge.difficulty + 1) % 4; this.ledge.next = 0.2; this.say(`wind difficulty ${this.ledge.difficulty}`, 1); }
    if (P.has('KeyC')) this.debugView.collision = !this.debugView.collision;
    if (P.has('KeyX')) this.debugView.exits = !this.debugView.exits;
    if (P.has('KeyM')) this.spawnMenehune();
    if (P.has('KeyP')) { this.night = true; this.spawnMarchers(); }
    if (P.has('KeyJ')) { this.raidBegin(); }
    if (P.has('KeyV')) { this.flags.socialAt = this.clock - 2; this.outcomes.social = this.outcomes.social || 'stepped-away'; }
  },

  /* ------------------------------------------------ drawing */
  drawWorld(ctx) {
    const G = Game, M = this.map; if (!M) return;
    const m = Assets.meta['kalmap_' + this.mapId];
    ctx.fillStyle = '#0a1a10'; ctx.fillRect(-2000, -2000, 8000, 8000);
    if (m) for (const t of m.tiles) { const im = G.imgOf(`tile_kal_${this.mapId}_${t.row}_${t.col}`); if (im) ctx.drawImage(im, (t.col - 1) * 512, (t.row - 1) * 512, 512, 512); }
    if (this.night) { // geometry-identical night: graded from the same tiles + localised torch/fire light
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(58,72,120)'; ctx.fillRect(0, 0, M.w, M.h); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(4,8,26,0.45)'; ctx.fillRect(0, 0, M.w, M.h); ctx.restore();
    }
    if (this.debugView.collision) { const g = M.grid; ctx.fillStyle = 'rgba(0,255,120,0.2)'; for (let i = 0; i < g.g.length; i++) if (g.g[i]) ctx.fillRect((i % g.w) * g.cell, ((i / g.w) | 0) * g.cell, g.cell, g.cell); }
    if (this.debugView.exits || G.debug) for (const p of M.portals) { ctx.save(); ctx.strokeStyle = 'rgba(255,230,80,0.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke(); ctx.fillStyle = '#ffe680'; ctx.font = '22px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`${p.id} → ${p.to[0]}`, p.x, p.y - p.r - 8); ctx.restore(); }
    const items = [];
    const push = (y, f) => items.push({ y, f });
    // props / camp
    if (this.mapId === 'campsite') this.drawCamp(push);
    for (const h of M.hides || []) push(h[1], () => this.drawHide(ctx, h));
    if (this.mapId === 'beach') { for (const s of this.skis) if (s.map === 'beach') push(s.y, () => this.drawSki(ctx, s)); if (this.heli && this.heli.state !== 'gone') push(this.heli.y + 400 * (1 - (this.heli.alt || 0)) , () => this.drawHeli(ctx, this.heli)); }
    for (const a of this.actorsIn(this.mapId)) if (a.mode !== 'riding') push(a.y, () => this.drawActor(ctx, a));
    for (const r of this.rangers) if (r.map === this.mapId && r.mode !== 'done') push(r.y, () => this.drawRanger(ctx, r));
    for (const mn of this.menehune) push(mn.y, () => this.drawMenehune(ctx, mn));
    if (this.marchers && this.marchers.map === this.mapId) for (const mm of this.marchers.line) push(mm.y, () => this.drawMarcher(ctx, mm));
    if (this.kama) { const k = this.kama; for (const v of k.vines) if (!v.dead) push(v.y, () => this.drawVine(ctx, v)); if (k.mode !== 'mist') push(k.y, () => this.drawKama(ctx, k)); }
    if (!this.hidden) push(G.ben.y, () => this.drawBen(ctx));
    if (this.pig) for (const c of (this.carrots && this.carrots[this.mapId]) || []) if (!c.taken) push(c.y, () => { const b = G.ben, near = dist(b.x, b.y, c.x, c.y) < 200; if (Assets.frame('guinea', 'item_0')) Assets.draw(ctx, 'guinea', 'item_0', c.x, c.y - 6, { h: 26, rot: -0.5 }); if (near) { ctx.save(); ctx.globalAlpha = 0.6 + 0.4 * Math.sin(G.time * 5); ctx.fillStyle = '#ffd95a'; ctx.font = '600 14px system-ui'; ctx.textAlign = 'center'; ctx.fillText('wild carrots', c.x, c.y - 34); ctx.restore(); } });
    if (this.pig && !this.hidden && this.phase !== 'TENT_WAKE') { const q = this.pig; push(q.y, () => { if (q.guarding) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(q.x, q.y - 12, 2, q.x, q.y - 12, 34); g.addColorStop(0, 'rgba(255,220,120,0.5)'); g.addColorStop(1, 'rgba(255,200,80,0)'); ctx.fillStyle = g; ctx.fillRect(q.x - 34, q.y - 46, 68, 68); ctx.restore(); } drawGuineaPig(ctx, q.x, q.y, 34, q.moving ? 'run' : 'idle', q.t, q.facing, 0, q.guarding); }); }
    items.sort((a, b) => a.y - b.y).forEach(i => i.f());
    if (this.kama) for (const ms of this.kama.mists) this.drawMist(ctx, ms);
    for (const w of this.pushes || []) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; Assets.draw(ctx, 'vfx', Assets.animFrame('vfx', 'wave', w.t), w.x, w.y, { h: 90, rot: w.a }); ctx.restore(); }
    for (const f of this.fx) { const a = Assets.anim('kfx', f.anim); if (!a) continue; const n = a.frames.length, i = Math.min(n - 1, Math.floor(f.t / f.dur * n)); ctx.save(); if (f.add) ctx.globalCompositeOperation = 'lighter'; Assets.draw(ctx, 'kfx', a.frames[i], f.x, f.y, { h: f.h, alpha: f.alpha * (f.t / f.dur > 0.7 ? 1 - (f.t / f.dur - 0.7) / 0.3 : 1) }); ctx.restore(); }
    if (this.mapId === 'crawlers-ledge' && this.ledge) this.drawWind(ctx);
    if (this.night) this.drawNightLights(ctx);
    this.drawGuide(ctx);
  },
  drawBen(ctx) {
    const G = Game, b = G.ben, D = DIRS[b.dir];
    if (b.asleep) return;
    let name = null;
    if (b.pose === 'hurt') name = Assets.animFrame('kben', 'hurt', b.poseT || 0);
    else if (b.pose === 'brace' || b.pose === 'kneel') name = Assets.animFrame('kben', 'kneel', G.time);
    else if (b.pose === 'cast') name = this.inv.knifeOut ? 'knife_slash' : 'fists';
    else if (this.inv.knifeOut && !b.moving) name = b.dir === 2 || b.dir === 1 || b.dir === 3 ? 'knife_E' : b.dir === 6 || b.dir === 5 || b.dir === 7 ? 'knife_W' : 'knife_idle';
    else if (b.moving) name = Assets.animFrame('kben', 'walk_' + D, b.phase * (this.chase ? 1.5 : 1));
    else name = Assets.animFrame('kben', 'idle', G.time);
    shadow(ctx, b.x, b.y, 16);
    ctx.save(); if (this.flags.grabbed > 0 && Math.floor(G.time * 10) % 2) ctx.globalAlpha = 0.85;
    Assets.draw(ctx, 'kben', name, b.x, b.y, { h: b.h }); ctx.restore();
  },
  drawActor(ctx, a) {
    if (a.kind === 'hiker') {
      const dir = a.dir, back = dir === 0 || dir === 7 || dir === 1, row = a.pack ? (back ? 'pack_N' : 'pack_S') : 'S';
      const an = `h${a.hi}_${row}`; let name = a.moving ? Assets.animFrame('hikers', an, a.phase || 0) : (Assets.anim('hikers', an) || { frames: [] }).frames[0];
      if (a.hurt > 0) name = `h${a.hi}_pose_0`;
      if (!name) return; shadow(ctx, a.x, a.y, 14); Assets.draw(ctx, 'hikers', name, a.x, a.y, { h: KCFG.benH * 1.02, flip: dir >= 5 || (a.pack && (dir === 6 || dir === 5 || dir === 7)) });
    } else if (a.kind === 'local') {
      const D = DIRS[a.dir], v = a.id + '_' + (D === 'N' || D === 'NE' || D === 'NW' ? 'N' : D === 'E' || D === 'SE' ? 'E' : D === 'W' || D === 'SW' ? 'W' : 'S');
      shadow(ctx, a.x, a.y, 14); ctx.save(); if (a.moving) ctx.translate(0, -Math.abs(Math.sin((a.phase || 0) * 9)) * 3); Assets.draw(ctx, 'camp', v, a.x, a.y, { h: KCFG.benH * 1.02 }); ctx.restore();
    }
  },
  drawRanger(ctx, r) {
    const D = DIRS[r.dir], d4 = D === 'N' || D === 'NE' || D === 'NW' ? 'N' : D === 'E' || D === 'SE' ? 'E' : D === 'W' || D === 'SW' ? 'W' : 'S';
    let name;
    if (r.mode === 'arrest') name = 'arrest_1'; else if (r.searching) name = Assets.animFrame('rangers', 'search', r.t); else if (r.moving) name = Assets.animFrame('rangers', (r.speed >= KCFG.rangerRun * 0.9 ? 'run_' : 'walk_') + d4, r.phase || 0); else name = r.v + '_' + d4;
    shadow(ctx, r.x, r.y, 14); Assets.draw(ctx, 'rangers', name, r.x, r.y, { h: KCFG.benH * (r.mode === 'arrest' ? 1.15 : 1) });
    if (this.night && r.searching) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(r.x, r.y - 20, 5, r.x, r.y - 20, 160); g.addColorStop(0, 'rgba(255,240,180,0.35)'); g.addColorStop(1, 'rgba(255,240,180,0)'); ctx.fillStyle = g; ctx.fillRect(r.x - 160, r.y - 180, 320, 320); ctx.restore(); }
  },
  drawHeli(ctx, h) {
    const alt = h.alt == null ? 1 : h.alt, lift = alt * 260;
    // shadow on the sand + downwash while airborne
    ctx.save(); ctx.globalAlpha = 0.35 * (0.4 + 0.6 * (1 - alt)); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(h.x, h.y + 30, 150 * (0.6 + 0.4 * (1 - alt)), 40, 0, 0, TAU); ctx.fill(); ctx.restore();
    if (alt > 0.05) { const fr = Assets.animFrame('kfx', 'downwash', h.rot); if (fr) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; Assets.draw(ctx, 'kfx', fr, h.x, h.y + 20, { h: 260 * (0.6 + 0.6 * alt) }); ctx.restore(); } }
    const body = h.state === 'landed' ? (h.t > 1.5 ? 'heli_open' : 'heli_closed') : 'heli_hover';
    Assets.draw(ctx, 'rangers', body, h.x, h.y - lift, { h: 120 });
    if (h.state !== 'landed' || h.t < 4) { const rf = Assets.animFrame('rangers', 'rotor', h.rot); ctx.save(); ctx.globalAlpha = 0.55; Assets.draw(ctx, 'rangers', rf, h.x + 6, h.y - lift - 52, { h: 34 }); ctx.restore(); }
  },
  drawSki(ctx, s) {
    const wake = s.mode === 'run', key = s.id === 'ski_r' ? 'ski_r' : 'ski_b'; const name = wake ? Assets.animFrame('camp', key + '_wake', Game.time) : Assets.animFrame('camp', key + '_idle', Game.time);
    if (wake) { const wf = Assets.animFrame('kfx', 'wake', Game.time); ctx.save(); ctx.globalAlpha = 0.8; Assets.draw(ctx, 'kfx', wf, s.x - 40, s.y + 10, { h: 60, flip: true }); ctx.restore(); }
    Assets.draw(ctx, 'camp', name, s.x, s.y, { h: 60 });
    if (wake) for (const a of this.actors) if (a.skiRef === s) { const rn = 'ride_' + a.id; if (Assets.frame('camp', rn)) { /* rider drawn by ski frame set */ } }
  },
  drawCamp(push) {
    const ctx = Game.ctx, C = this.map.camp, c = this.camp;
    const tent = c.state === 'burned' ? 'tent_burned' : c.tentOpen && c.state === 'intact' ? 'tent_open' : 'tent_closed';
    push(C.tent[1] + 30, () => { Assets.draw(ctx, 'camp', tent, C.tent[0], C.tent[1] + 30, { h: 120 }); if (c.state === 'burning') this.drawTentFire(ctx, C.tent); });
    if (c.state !== 'burned') for (const [x, y, n] of C.props) push(y, () => Assets.draw(ctx, 'camp', n, x, y, { h: n === 'stove' ? 34 : 28 }));
    push(C.fire[1], () => { Assets.draw(ctx, 'camp', 'firering', C.fire[0], C.fire[1], { h: 40 }); if (this.night && c.state !== 'burned') { const fr = Assets.animFrame('kfx', 'blaze', Game.time); ctx.save(); ctx.globalCompositeOperation = 'lighter'; Assets.draw(ctx, 'kfx', fr, C.fire[0], C.fire[1] - 14, { h: 46 }); ctx.restore(); } });
    for (const v of this.map.visitorCamps) push(v.tent[1] + 20, () => Assets.draw(ctx, 'camp', v.tent[2] || 'vtent_' + v.style, v.tent[0], v.tent[1] + 20, { h: 100 }));
  },
  drawTentFire(ctx, T) {
    const c = this.camp, F = KCFG.fire, t = c.fireT;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (t < F.ignite + 1) Assets.draw(ctx, 'kfx', Assets.animFrame('kfx', 'fire', t), T[0], T[1] + 10, { h: 120 * clamp(t / F.ignite, 0.3, 1) });
    else { const k = t > F.black ? Math.max(0.35, 1 - (t - F.black) / (F.burned - F.black)) : 1; Assets.draw(ctx, 'kfx', Assets.animFrame('kfx', 'blaze', t), T[0], T[1] + 10, { h: 150 * k }); Assets.draw(ctx, 'kfx', Assets.animFrame('kfx', 'blaze', t + 0.2), T[0] - 40, T[1] + 20, { h: 90 * k }); Assets.draw(ctx, 'kfx', Assets.animFrame('kfx', 'blaze', t + 0.4), T[0] + 40, T[1] + 24, { h: 100 * k }); }
    const g = ctx.createRadialGradient(T[0], T[1], 10, T[0], T[1], 260); g.addColorStop(0, 'rgba(255,150,60,0.35)'); g.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = g; ctx.fillRect(T[0] - 260, T[1] - 260, 520, 520);
    ctx.restore();
  },
  drawHide(ctx, h) {
    const b = Game.ben, near = dist(b.x, b.y, h[0], h[1]) < 110; const fr = Assets.animFrame('kfx', 'rustle', Game.time * (near ? 1.6 : 0.6));
    ctx.save(); Assets.draw(ctx, 'kfx', fr, h[0], h[1], { h: 64 }); ctx.restore();
    if (this.hidden && this.hidden.x === h[0]) { const hf = Assets.animFrame('kben', 'hide', Game.time); ctx.save(); ctx.globalAlpha = 0.5; Assets.draw(ctx, 'kben', hf, h[0], h[1] + 12, { h: 40 }); ctx.restore(); }
    if (near && !this.hidden) { const ok = !this.chase || !this.rangers.some(r => r.map === this.mapId && r.mode !== 'done' && this.onScreen(r.x, r.y)); ctx.save(); ctx.globalAlpha = 0.6 + 0.4 * Math.sin(Game.time * 5); Assets.draw(ctx, 'kfx', 'hide_icon', h[0], h[1] - 60, { h: 30 }); if (Game.debug) { ctx.fillStyle = ok ? '#8f8' : '#f66'; ctx.font = '16px system-ui'; ctx.textAlign = 'center'; ctx.fillText(ok ? 'hide: eligible' : 'hide: ranger on screen', h[0], h[1] - 82); } ctx.restore(); }
  },
  drawMenehune(ctx, m) {
    const name = m.mode === 'vanish' ? Assets.animFrame('super', 'men_van', m.t) : m.mode === 'move' ? Assets.animFrame('super', 'men_walk', m.t) : Assets.animFrame('super', 'men_idle', m.t);
    ctx.save(); ctx.globalAlpha = m.alpha * (m.mode === 'vanish' ? Math.max(0, 1 - m.t / 0.9) : 1); Assets.draw(ctx, 'super', name, m.x, m.y, { h: 44, flip: m.facing < 0 }); ctx.restore();
  },
  drawMarcher(ctx, m) {
    const name = Assets.animFrame('super', 'nm_walk', m.t); ctx.save(); ctx.globalAlpha = m.alpha * 0.9; Assets.draw(ctx, 'super', name, m.x, m.y, { h: 96, flip: m.dirx < 0 }); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const tf = Assets.animFrame('kfx', 'torch', m.t); Assets.draw(ctx, 'kfx', tf, m.x + (m.dirx < 0 ? -22 : 22), m.y - 70, { h: 30 });
    const g = ctx.createRadialGradient(m.x, m.y - 60, 4, m.x, m.y - 60, 140); g.addColorStop(0, 'rgba(255,170,70,0.35)'); g.addColorStop(1, 'rgba(255,140,40,0)'); ctx.fillStyle = g; ctx.fillRect(m.x - 140, m.y - 200, 280, 280); ctx.restore();
  },
  drawKama(ctx, k) {
    let name, alpha = 1, h = 230;
    if (k.mode === 'materialise') name = 'kama_' + k.stage; else if (k.mode === 'dissolve') { name = 'kama_' + Math.max(0, 5 - Math.floor(k.t / KCFG.kama.stage)); alpha = 0.9; } else name = k.attack > 0 ? Assets.animFrame('super', 'kama_att', 0.66 - k.attack) : (Game.ben.x < k.x ? 'kama_side' : 'kama_def');
    if (k.warn > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(k.x, k.y - 110, 10, k.x, k.y - 110, 170); g.addColorStop(0, 'rgba(255,90,40,0.55)'); g.addColorStop(1, 'rgba(255,60,20,0)'); ctx.fillStyle = g; ctx.fillRect(k.x - 170, k.y - 280, 340, 340); ctx.restore(); }
    if (k.invuln > 0) alpha *= 0.6 + 0.4 * Math.sin(Game.time * 40);
    ctx.save(); ctx.globalAlpha = alpha; if (k.mode === 'combat') shadow(ctx, k.x, k.y, 30); Assets.draw(ctx, 'super', name, k.x, k.y, { h, flip: k.mode === 'combat' && Game.ben.x < k.x }); ctx.restore();
  },
  drawVine(ctx, v) {
    const b = Game.ben, side = b.x < v.x ? 'L' : 'R'; let an = v.mode === 'emerge' ? 'vine_emerge' : v.mode === 'crawl' ? 'vine_crawl_' + side : v.mode === 'grab' ? 'vine_grab_' + side : v.mode === 'recoil' ? 'vine_recoil' : 'vine_sever';
    const name = Assets.animFrame('kfx', an, v.mode === 'crawl' ? v.t % 0.48 : v.t); Assets.draw(ctx, 'kfx', name, v.x, v.y, { h: 60 });
  },
  drawMist(ctx, m) { const name = Assets.animFrame('kfx', 'omist', m.t * 8 / m.dur * 0.35); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.7; Assets.draw(ctx, 'kfx', name, m.x, m.y, { h: m.size }); ctx.restore(); },
  drawWind(ctx) {
    const L = this.ledge, g = L.gust; if (!g) return; const b = Game.ben;
    const an = g.phase === 'cue' ? 'wind_gentle' : g.phase === 'react' ? 'wind_strong' : 'wind_violent';
    for (let i = 0; i < (g.phase === 'gust' ? 6 : 3); i++) { const name = Assets.animFrame('kfx', an, Game.time + i * 0.13); ctx.save(); ctx.globalAlpha = 0.7; Assets.draw(ctx, 'kfx', name, b.x - 200 + ((Game.time * 500 + i * 140) % 500), b.y - 150 + i * 55, { h: 50, flip: true }); ctx.restore(); }
  },
  drawNightLights(ctx) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const b = Game.ben; const g = ctx.createRadialGradient(b.x, b.y - 20, 6, b.x, b.y - 20, 240); g.addColorStop(0, 'rgba(255,220,160,0.22)'); g.addColorStop(1, 'rgba(255,220,160,0)'); ctx.fillStyle = g; ctx.fillRect(b.x - 240, b.y - 260, 480, 480);
    if (this.mapId === 'campsite' && this.camp.state !== 'burned') { const C = this.map.camp.fire; const g2 = ctx.createRadialGradient(C[0], C[1], 6, C[0], C[1], 300); g2.addColorStop(0, 'rgba(255,170,80,0.45)'); g2.addColorStop(1, 'rgba(255,140,60,0)'); ctx.fillStyle = g2; ctx.fillRect(C[0] - 300, C[1] - 300, 600, 600); }
    ctx.restore();
  },
  drawGuide(ctx) { // world-space: arrow over the target + edge pointer when it is off screen
    const g = this.guideStep(); this.guideNow = g; if (!g || !g.target) return;
    const G = Game, [tx, ty] = g.target, b = G.ben, pulse = 0.5 + 0.5 * Math.sin(G.time * 5);
    ctx.save(); ctx.strokeStyle = `rgba(255,215,90,${0.55 + 0.4 * pulse})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(tx, ty, 34 + pulse * 8, 17 + pulse * 4, 0, 0, TAU); ctx.stroke();
    const ax = tx, ay = ty - 70 - pulse * 12; ctx.fillStyle = '#ffd95a'; ctx.shadowColor = '#000'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.moveTo(ax, ay + 26); ctx.lineTo(ax - 18, ay); ctx.lineTo(ax - 7, ay); ctx.lineTo(ax - 7, ay - 22); ctx.lineTo(ax + 7, ay - 22); ctx.lineTo(ax + 7, ay); ctx.lineTo(ax + 18, ay); ctx.closePath(); ctx.fill(); ctx.restore();
    // trail of dots along the planned route so the way is visible even in dense jungle
    if (!this.guidePath || G.time - (this.guidePathT || -9) > 1.2 || this.guidePathTo !== tx + ',' + ty) { this.guidePath = this.path(this.map, b.x, b.y, tx, ty); this.guidePathT = G.time; this.guidePathTo = tx + ',' + ty; }
    ctx.save(); ctx.fillStyle = `rgba(255,225,120,${0.45 + 0.3 * pulse})`; let prev = [b.x, b.y], acc = (G.time * 60) % 34;
    for (const pt of this.guidePath) { const d = Math.hypot(pt[0] - prev[0], pt[1] - prev[1]); for (let t = acc; t < d; t += 34) { const x = prev[0] + (pt[0] - prev[0]) * t / d, y = prev[1] + (pt[1] - prev[1]) * t / d; ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill(); } acc = (acc - d) % 34; if (acc < 0) acc += 34; prev = pt; }
    ctx.restore();
  },
  drawHud(ctx) {
    const G = Game, W = G.W, H = G.H;
    ctx.save(); ctx.textAlign = 'center';
    // big guide text along the bottom
    const gd = this.guideNow; if (gd && !this.choice && !this.dialog && this.phase !== 'ARRESTED') {
      ctx.font = `700 ${Math.min(22, W / 34)}px system-ui, sans-serif`; const words = gd.text.split(' '); const lines = []; let line = '';
      for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > W - 80 && line) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line);
      const lh = Math.min(26, W / 30), bh = lines.length * lh + 18, y0 = H - 40 - bh; ctx.fillStyle = 'rgba(0,0,0,0.62)'; rr(ctx, 24, y0, W - 48, bh, 10); ctx.fill(); ctx.strokeStyle = 'rgba(255,215,90,0.7)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#ffe28a'; lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + 20 + i * lh + 4));
      if (gd.target) { const [sx, sy] = G.worldToScreen(gd.target[0], gd.target[1]); if (sx < 0 || sy < 0 || sx > W || sy > H) { const [bx, by] = G.worldToScreen(G.ben.x, G.ben.y), a = Math.atan2(sy - by, sx - bx);
        const ex = clamp(W / 2 + Math.cos(a) * W * 0.44, 30, W - 30), ey = clamp(H / 2 + Math.sin(a) * H * 0.38, 90, H - 110); ctx.save(); ctx.translate(ex, ey); ctx.rotate(a); ctx.fillStyle = '#ffd95a'; ctx.shadowColor = '#000'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(-14, -16); ctx.lineTo(-6, 0); ctx.lineTo(-14, 16); ctx.closePath(); ctx.fill(); ctx.restore(); } }
    }
    if (this.title) { const a = Math.min(1, this.title.t * 2, (3 - this.title.t) * 1.5); ctx.globalAlpha = clamp(a, 0, 1); ctx.fillStyle = 'rgba(0,0,0,0.5)'; rr(ctx, W / 2 - 150, 44, 300, 40, 8); ctx.fill(); ctx.fillStyle = '#f6e7c1'; ctx.font = '600 18px Georgia, serif'; ctx.fillText(this.title.text.toUpperCase(), W / 2, 71); ctx.globalAlpha = 1; }
    // clock + phase
    const hh = Math.floor(this.clock), mm = Math.floor((this.clock - hh) * 60); ctx.font = '12px system-ui'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'right';
    ctx.fillText(`${this.night ? '☾' : '☀'} ${hh}:${mm < 10 ? '0' : ''}${mm}   ${this.mapId}`, W - 14, H - 14);
    if (this.inv.knife) ctx.fillText(this.inv.knifeOut ? 'KNIFE OUT (K)' : 'knife (K)', W - 14, H - 30);
    if (this.pig) ctx.fillText(`🥕 ${G.inv.carrots}  ·  🐹 ${G.inv.pigCharges}/${CFG.pigAttacksPerCarrot}`, W - 14, H - 46);
    if (this.chase) { ctx.textAlign = 'center'; ctx.fillStyle = '#ffb0a0'; ctx.font = '600 13px system-ui'; ctx.fillText(`RANGERS SEARCHING  ·  ${this.rangers.filter(r => r.map === this.mapId && r.mode !== 'done').length} on this screen`, W / 2, 96); }
    if (this.hidden) { ctx.textAlign = 'center'; ctx.fillStyle = '#cfe9c0'; ctx.font = '600 13px system-ui'; ctx.fillText('HIDDEN', W / 2, 118); }
    if (this.ledge && this.ledge.gust) { const g = this.ledge.gust; ctx.textAlign = 'center'; ctx.font = '600 20px system-ui'; ctx.fillStyle = g.phase === 'gust' ? '#9fd8ff' : '#ffe08a'; ctx.fillText(g.phase === 'cue' ? '~ wind ~' : g.phase === 'react' ? '▶ BRACE RIGHT ◀' : this.ledge.sheltered ? 'BRACED' : 'GUST!', W / 2, H * 0.3); }
    if (this.kama && this.kama.mode === 'combat') { const n = KCFG.kama.hitsToYield; ctx.textAlign = 'center'; for (let i = 0; i < n; i++) { ctx.save(); ctx.translate(W / 2 - (n - 1) * 15 + i * 30, 100); ctx.rotate(0.5); ctx.fillStyle = i < this.kama.hits ? '#ffcf70' : 'rgba(255,255,255,0.2)'; ctx.fillRect(-5, -9, 10, 18); ctx.restore(); } }
    // prompt
    const p = this.prompt; if (p && !this.choice && !this.dialog && this.phase !== 'ARRESTED') { ctx.textAlign = 'center'; ctx.font = '600 15px system-ui, sans-serif'; const t = (Input.touchMode ? 'Tap: ' : '[E] or click: ') + p.text; const tw = ctx.measureText(t).width + 28; ctx.fillStyle = 'rgba(20,14,6,0.7)'; rr(ctx, W / 2 - tw / 2, H - 150, tw, 32, 16); ctx.fill(); ctx.strokeStyle = 'rgba(255,215,120,0.6)'; ctx.stroke(); ctx.fillStyle = '#ffe7a6'; ctx.fillText(t, W / 2, H - 129); }
    // dialogue
    if (this.dialog) { const d = this.dialog; const w = Math.min(W - 40, 620); ctx.fillStyle = 'rgba(8,10,16,0.82)'; rr(ctx, W / 2 - w / 2, H - 150, w, 92, 12); ctx.fill(); ctx.strokeStyle = 'rgba(255,215,120,0.5)'; ctx.stroke(); ctx.textAlign = 'left'; ctx.fillStyle = '#ffd98a'; ctx.font = '600 14px system-ui'; ctx.fillText(d.who, W / 2 - w / 2 + 18, H - 124); ctx.fillStyle = '#f2ecdc'; ctx.font = '15px system-ui'; this.wrap(ctx, d.text, W / 2 - w / 2 + 18, H - 100, w - 36, 20); ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '11px system-ui'; ctx.textAlign = 'right'; ctx.fillText('E / tap to continue', W / 2 + w / 2 - 14, H - 66); }
    if (this.choice) { const c = this.choice; const w = Math.min(W - 40, 640), n = c.options.length, hgt = 60 + n * 40; const y0 = H / 2 - hgt / 2; ctx.fillStyle = 'rgba(8,10,16,0.88)'; rr(ctx, W / 2 - w / 2, y0, w, hgt, 12); ctx.fill(); ctx.strokeStyle = 'rgba(255,215,120,0.5)'; ctx.stroke(); ctx.textAlign = 'left'; ctx.fillStyle = '#f2ecdc'; ctx.font = 'italic 14px system-ui'; ctx.fillText(c.text, W / 2 - w / 2 + 18, y0 + 28); c.rects = [];
      c.options.forEach((o, i) => { const y = y0 + 48 + i * 40; ctx.fillStyle = 'rgba(255,255,255,0.07)'; rr(ctx, W / 2 - w / 2 + 12, y, w - 24, 32, 8); ctx.fill(); ctx.fillStyle = '#ffe7a6'; ctx.font = '600 14px system-ui'; ctx.fillText(`${i + 1}.  ${o.label}`, W / 2 - w / 2 + 24, y + 21); c.rects.push([W / 2 - w / 2 + 12, y, w - 24, 32]); }); }
    if (this.phase === 'ARRESTED') { ctx.textAlign = 'center'; ctx.fillStyle = '#ffd0c0'; ctx.font = '600 26px Georgia, serif'; ctx.fillText('ARRESTED', W / 2, H * 0.4); }
    ctx.restore();
  },
  wrap(ctx, text, x, y, maxW, lh) { const words = text.split(' '); let line = ''; for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = w; } else line = t; } if (line) ctx.fillText(line, x, y); },
  debugLines() { const r = this.rangers.filter(x => x.mode !== 'done'); return [`KALALAU phase ${this.phase}  map ${this.mapId}  clock ${this.clock.toFixed(1)} ${this.night ? 'NIGHT' : 'day'}  alert ${this.alert}  camp ${this.camp.state}`,
    `rangers ${r.length} [${r.map(x => x.map + (x.map === this.mapId ? '*' : '')).join(',')}]  heli ${this.heli ? this.heli.state : '-'}  hidden ${!!this.hidden}  kama ${this.kama ? this.kama.mode + '/' + this.kama.stage : '-'}  ledge ${this.ledge ? (this.ledge.gust ? this.ledge.gust.phase : 'calm') + ' off ' + (this.ledge.offset | 0) + (this.ledge.sheltered ? ' SHELTERED' : '') : '-'}`,
    `outcomes ${JSON.stringify(this.outcomes)}  flags raid=${this.flags.raid} visitors=${this.flags.visitors}`,
    'debug: T night · R rangers · H heli · F fire · G Kamapuaʻa · W wind · C collision · X exits · M menehune · P marchers · J jet-skis · V skip social']; },
};

/* ---- Game state wrappers ---- */
S.KALALAU = {
  enter() { if (!Kal.map) Kal.begin(true); Game.mode = 'kal'; this.objective = Game.objective; },
  update(dt, live) { Kal.update(dt, live); },
  draw(ctx) { },
  prompt() { return null; },
  exitFade: { fade: 0.5 },
  debugSkip() { },
};
S.KALALAU_END = {
  enter() { Game.mode = 'end'; Game.objective = ''; Kal.outcomes.chapterExit = true; Save.clear(); Kal.map = null; Audio.ambience({}, 2); },
  update(dt, live) { if (live && this.stateT > 6 && (Input.action() || Input.fire())) { Game.started = false; Game.state = null; } },
  draw(ctx) {
    const G = Game, W = G.W, H = G.H, t = G.stateT; ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.textAlign = 'center';
    const a = clamp((t - 0.5) / 1.5, 0, 1); ctx.globalAlpha = a; ctx.fillStyle = '#e6e2d6'; ctx.font = `italic ${Math.min(26, W / 22)}px Georgia, serif`; ctx.fillText('He walked out along the cliffs with the wind at his back.', W / 2, H * 0.42);
    const a2 = clamp((t - 2.5) / 1.5, 0, 1); ctx.globalAlpha = a2; ctx.fillStyle = '#ffd98a'; ctx.font = `600 ${Math.min(40, W / 14)}px Georgia, serif`; ctx.fillText('END OF ACT 2', W / 2, H * 0.55);
    if (t > 6) { ctx.globalAlpha = 0.6; ctx.fillStyle = '#9aa3b8'; ctx.font = '13px system-ui'; ctx.fillText('Tap or press Enter to return to the title', W / 2, H - 30); }
    ctx.globalAlpha = 1;
  },
};
MODE_OF.KALALAU = 'kal'; MODE_OF.KALALAU_END = 'end';
COMPLETE_WHEN.KALALAU = 'chapter phases (see Kal.phase); ends when Ben leaves Crawler\'s Ledge';
COMPLETE_WHEN.KALALAU_END = 'end card; tap returns to the title';
window.KOA.Kal = Kal; window.KOA.KCFG = KCFG; window.KOA.KalOpts = KalOpts;
