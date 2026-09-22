/* King of Atlantis — core: config, math, RNG, input, audio, assets, pooling, save. */
'use strict';

const CFG = {
  // economy / stats
  startMoney: 120, dailyIncome: 35, groceryCost: 42,
  startCarrots: 3, carrotsFromGroceries: 4,
  feedRestoreMorning: 25, feedRestoreEvening: 15,
  iceCreamHungerRelief: 70, groceriesHungerRelief: 0,
  // psychic wave
  windup: 0.30, cooldown: 0.85, waveSpeed: 1500, waveRange: 2000, shotCost: 2, killRestore: 4,
  overloadPerShot: 8, overloadDecay: 5,
  // lesser entities
  lesserEncounters: 4, lesserSilence: 1.6, lesserContactDrain: 18,
  // demon
  demonOrbitsRX: [1300, 1060, 840, 640, 460], demonOrbitRYRatio: 0.6,
  demonAngSpeed: [0.32, 0.40, 0.50, 0.62, 0.78], demonPulseDrain: 8, demonHitRadius: 120,
  // street
  streetShotCost: 1, streetCooldown: 0.6, streetWaveSpeed: 950, streetWaveRange: 650,
  benStreetSpeed: 215, benStreetHeight: 66, ingressDrain: 10, ingressOverload: 25, vehicleDamage: 15,
  // room/backyard
  // camera framing (1 = previous framing). Night fight zooms back in after the reveal; day room + street sit closer.
  battleZoom: 2.25, demonZoom: 1.9, roomZoom: 1.55, streetZoom: 1.5,
  // difficulty: night N runs at daySpeedUp^(N-1) speed; the act ends after night finalNight's demon
  daySpeedUp: 1.5, lastDay: 2,
  // guinea pig guardian (day 2+): circles Ben and knocks back anything that comes within range
  pigGuardRange: 170, pigOrbitRadius: 46, pigOrbitSpeed: 6.5, pigAttacksPerCarrot: 2,
  // beach barrier wave
  beachFoes: 4, beachFoeHp: 2, beachFoeSpeed: 115, beachContactDrain: 8, beachContactHurt: 6,
  benRoomSpeed: 330, benRoomHeight: 235, benYardHeight: 118,
};

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
// screen angle (atan2(dy,dx), y down) -> compass dir index
function dirFromVec(dx, dy) {
  const a = Math.atan2(dx, -dy); // 0 = north, clockwise
  return ((Math.round(a / (TAU / 8)) % 8) + 8) % 8;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------------ pooling */
class Pool {
  constructor(make, size) { this.make = make; this.items = []; for (let i = 0; i < size; i++) this.items.push(Object.assign(make(), { alive: false })); }
  get() {
    let o = this.items.find(i => !i.alive);
    if (!o) { o = Object.assign(this.make(), { alive: false }); this.items.push(o); }
    o.alive = true; return o;
  }
  each(fn) { for (const o of this.items) if (o.alive) fn(o); }
  count() { let n = 0; for (const o of this.items) if (o.alive) n++; return n; }
  clear() { for (const o of this.items) o.alive = false; }
}

/* ------------------------------------------------------------------ input */
const Input = {
  keys: new Set(), pressed: new Set(),
  pointer: { x: 0, y: 0, down: false, moved: false, tapQueue: [] },
  stick: { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 },
  touchMode: false, actionTap: false,
  init(canvas) {
    const prevent = e => { if (e.cancelable) e.preventDefault(); };
    window.addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Space'].includes(e.key)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code); Game.onAnyInput();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    canvas.tabIndex = 0; canvas.style.outline = 'none';
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointerdown', e => {
      prevent(e); Game.onAnyInput();
      // preventDefault on pointerdown also blocks focus, so give the page keyboard focus explicitly
      // (inside an embedded frame, keys otherwise go to the host page and E/WASD appear dead)
      try { window.focus(); canvas.focus({ preventScroll: true }); } catch (err) { }
      const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      if (e.pointerType === 'touch') this.touchMode = true;
      this.pointer.x = x; this.pointer.y = y; this.pointer.moved = true;
      // on-screen action button
      const ab = UI.actionButton();
      if (this.touchMode && dist(x, y, ab.x, ab.y) < ab.r * 1.2) { this.actionTap = true; return; }
      const fb = UI.fireButton && UI.fireButton();
      if (this.touchMode && fb && dist(x, y, fb.x, fb.y) < fb.r * 1.25) { this.fireTap = true; return; }
      if (this.touchMode && Game.wantsStick() && x < r.width * 0.5 && !this.stick.active) {
        Object.assign(this.stick, { active: true, id: e.pointerId, ox: x, oy: y, x: 0, y: 0, t0: performance.now(), maxd: 0 });
        return;
      }
      this.pointer.down = true; this.pointer.tapQueue.push({ x, y });
    }, { passive: false });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      if (this.stick.active && e.pointerId === this.stick.id) {
        let dx = x - this.stick.ox, dy = y - this.stick.oy; const m = Math.hypot(dx, dy), R = 56;
        this.stick.maxd = Math.max(this.stick.maxd || 0, m);
        if (m > R) { dx *= R / m; dy *= R / m; }
        this.stick.x = dx / R; this.stick.y = dy / R; return;
      }
      this.pointer.x = x; this.pointer.y = y; this.pointer.moved = true;
    });
    const up = e => {
      if (this.stick.active && e.pointerId === this.stick.id) {
        // a quick touch that never dragged is a tap, not a stick gesture
        if ((this.stick.maxd || 0) < 12 && performance.now() - this.stick.t0 < 350) this.pointer.tapQueue.push({ x: this.stick.ox, y: this.stick.oy });
        this.stick.active = false; this.stick.x = this.stick.y = 0;
      }
      this.pointer.down = false;
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    // stop page scroll / zoom / context menu during play
    ['touchstart', 'touchmove', 'touchend', 'gesturestart'].forEach(t => document.addEventListener(t, prevent, { passive: false }));
    canvas.addEventListener('contextmenu', prevent);
    document.addEventListener('wheel', prevent, { passive: false });
  },
  move() {
    let x = 0, y = 0; const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (this.stick.active) { x += this.stick.x; y += this.stick.y; }
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    if (m < 0.18) return { x: 0, y: 0 };
    return { x, y };
  },
  action() { return this.pressed.has('KeyE') || this.pressed.has('Enter') || this.actionTap; },
  fire() { return this.pressed.has('Space') || this.pointer.tapQueue.length > 0; },
  endFrame() { this.pressed.clear(); this.pointer.tapQueue.length = 0; this.actionTap = false; this.fireTap = false; },
};

/* ------------------------------------------------------------------ audio (procedural WebAudio) */
const Audio = {
  ctx: null, master: null, layers: {}, noise: null, enabled: true,
  init() {
    Music.unlock();
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { this.enabled = false; return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; d[i] = w; }
    this.noise = buf;
    const brown = c.createBuffer(1, len, c.sampleRate), bd = brown.getChannelData(0);
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    this.brown = brown;
    this.buildLayers();
  },
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  src(buf, loop = true) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; return s; },
  buildLayers() {
    const c = this.ctx;
    const mk = () => { const g = c.createGain(); g.gain.value = 0; g.connect(this.master); return g; };
    // room: brown noise + fan hum
    { const g = mk(); const n = this.src(this.brown); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      n.connect(lp); lp.connect(g); n.start();
      const o = c.createOscillator(); o.frequency.value = 58; const og = c.createGain(); og.gain.value = 0.05; o.connect(og); og.connect(g); o.start();
      this.layers.room = g; }
    // astral: detuned low drones + breathing filtered noise
    { const g = mk();
      [43, 64.5, 86.7].forEach((f, i) => { const o = c.createOscillator(); o.type = i === 1 ? 'triangle' : 'sine'; o.frequency.value = f;
        const og = c.createGain(); og.gain.value = 0.22 / (i + 1); o.connect(og); og.connect(g); o.start(); });
      const n = this.src(this.noise); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 0.7;
      const ng = c.createGain(); ng.gain.value = 0.18; n.connect(bp); bp.connect(ng); ng.connect(g); n.start();
      const lfo = c.createOscillator(); lfo.frequency.value = 0.13; const lg = c.createGain(); lg.gain.value = 0.12; lfo.connect(lg); lg.connect(ng.gain); lfo.start();
      this.layers.astral = g; }
    // morning: soft air
    { const g = mk(); const n = this.src(this.noise); const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const ng = c.createGain(); ng.gain.value = 0.025; n.connect(hp); hp.connect(ng); ng.connect(g); n.start(); this.layers.morning = g; }
    // street: traffic wash
    { const g = mk(); const n = this.src(this.brown); const bp = c.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 900;
      const ng = c.createGain(); ng.gain.value = 0.35; n.connect(bp); bp.connect(ng); ng.connect(g); n.start(); this.layers.street = g; }
    // evening: crickets (amplitude-modulated high sine)
    { const g = mk(); const o = c.createOscillator(); o.frequency.value = 4400; const am = c.createGain(); am.gain.value = 0;
      const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 14; const lg = c.createGain(); lg.gain.value = 0.02;
      lfo.connect(lg); lg.connect(am.gain); o.connect(am); am.connect(g); o.start(); lfo.start(); this.layers.evening = g; }
  },
  ambience(levels, time = 1.5) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    for (const k in this.layers) {
      const target = (levels[k] || 0);
      const p = this.layers[k].gain; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(target, t + time);
    }
  },
  env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); },
  tone(freq, dur, { type = 'sine', vol = 0.2, to = null, delay = 0, attack = 0.01 } = {}) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain(); this.env(g, t, attack, vol, dur); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + attack + dur + 0.05);
  },
  burst(dur, { freq = 800, q = 1, type = 'bandpass', vol = 0.3, to = null, delay = 0, attack = 0.005 } = {}) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + delay;
    const n = this.src(this.noise, false); const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain(); this.env(g, t, attack, vol, dur); n.connect(f); f.connect(g); g.connect(this.master); n.start(t); n.stop(t + dur + 0.1);
  },
  // chiptune vehicle pass-by: square-wave engine with a doppler pitch drop, panned to where the car is
  carPass(pan = 0, vol = 0.5, kind = 'hatch') {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const base = kind === 'truck' ? 70 : kind === 'police' ? 95 : 110;
    const o = c.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(base * 1.35, t); o.frequency.linearRampToValueAtTime(base * 1.4, t + 0.7); o.frequency.exponentialRampToValueAtTime(base * 0.8, t + 1.5);
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.setValueAtTime(base * 2.02, t); o2.frequency.exponentialRampToValueAtTime(base * 1.2, t + 1.5);
    const lfo = c.createOscillator(); lfo.frequency.value = 22; const lg = c.createGain(); lg.gain.value = base * 0.08; lfo.connect(lg); lg.connect(o.frequency);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07 * vol, t + 0.6); g.gain.linearRampToValueAtTime(0.09 * vol, t + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    const g2 = c.createGain(); g2.gain.value = 0.35;
    let out = g; if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.setValueAtTime(clamp(-pan, -1, 1), t); p.pan.linearRampToValueAtTime(clamp(pan, -1, 1), t + 1.6); g.connect(p); out = p; }
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); out.connect(this.master);
    [o, o2, lfo].forEach(x => { x.start(t); x.stop(t + 1.8); });
    if (kind === 'police') { [0, 0.35, 0.7, 1.05].forEach((d, i) => this.tone(i % 2 ? 660 : 880, 0.3, { type: 'square', vol: 0.03 * vol, delay: d })); }
  },
  // pedestrian call-outs via the browser's speech engine (silently skipped where unavailable)
  say(text, { pitch = 1, rate = 1.05 } = {}) {
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
      if (speechSynthesis.speaking) return;
      const u = new SpeechSynthesisUtterance(text); u.pitch = pitch; u.rate = rate; u.volume = 0.9;
      speechSynthesis.speak(u);
    } catch (e) { }
  },
  sfx(name) {
    if (!this.ctx) return;
    Game.lastSfx = name;
    switch (name) {
      case 'pressure': this.tone(70, 1.4, { to: 34, vol: 0.35, attack: 0.3 }); this.burst(1.2, { freq: 120, type: 'lowpass', vol: 0.25, attack: 0.4 }); break;
      case 'distant': this.burst(1.6, { freq: 300, to: 900, q: 2, vol: 0.12, attack: 0.6 }); break;
      case 'tonal': [196, 294, 392].forEach((f, i) => this.tone(f, 1.6, { vol: 0.08, delay: i * 0.22, attack: 0.05 })); break;
      case 'impact': this.tone(90, 0.5, { to: 40, vol: 0.4 }); this.burst(0.35, { freq: 200, type: 'lowpass', vol: 0.3 }); break;
      case 'pulse': this.tone(55, 2.0, { vol: 0.3, attack: 0.5 }); this.tone(110.5, 2.0, { vol: 0.1, attack: 0.5 }); break;
      case 'charge': this.tone(220, CFG.windup, { to: 880, vol: 0.12, type: 'triangle' }); break;
      case 'launch': this.burst(0.35, { freq: 500, to: 2600, q: 3, vol: 0.28 }); this.tone(660, 0.25, { to: 330, vol: 0.08 }); break;
      case 'empty': this.tone(160, 0.12, { vol: 0.08, type: 'square' }); break;
      case 'hit': this.tone(140, 0.25, { to: 60, vol: 0.35 }); this.burst(0.25, { freq: 2400, q: 1, vol: 0.2 }); break;
      case 'dissolve': [1320, 990, 740].forEach((f, i) => this.tone(f, 0.9, { vol: 0.05, delay: i * 0.12, to: f * 0.7 })); this.burst(0.8, { freq: 3000, q: 4, vol: 0.05, attack: 0.1 }); break;
      case 'drain': this.tone(300, 0.5, { to: 90, vol: 0.2, type: 'sawtooth' }); break;
      case 'growl': this.tone(52, 0.9, { vol: 0.28, type: 'sawtooth', to: 38 }); this.burst(0.9, { freq: 160, vol: 0.2, type: 'lowpass' }); break;
      case 'lunge': this.tone(60, 1.2, { to: 240, vol: 0.3, type: 'sawtooth', attack: 0.2 }); break;
      case 'fracture': this.burst(0.4, { freq: 3500, q: 6, vol: 0.2 }); this.tone(900, 0.3, { to: 300, vol: 0.12, type: 'triangle' }); break;
      case 'shatter': this.burst(1.4, { freq: 4000, q: 2, vol: 0.3, to: 800 }); this.tone(80, 1.6, { to: 30, vol: 0.4 }); break;
      case 'victory': [261.6, 329.6, 392, 523.3].forEach((f, i) => this.tone(f, 2.6, { vol: 0.08, delay: i * 0.18, attack: 0.3 })); break;
      case 'door': this.burst(0.18, { freq: 300, type: 'lowpass', vol: 0.4 }); this.tone(120, 0.15, { vol: 0.2 }); break;
      case 'squeak': [0, 0.14, 0.26].forEach(d => this.tone(1900, 0.08, { to: 2600, vol: 0.07, delay: d })); break;
      case 'munch': [0, 0.18, 0.36, 0.54].forEach(d => this.burst(0.06, { freq: 2200, q: 1.5, vol: 0.12, delay: d })); break;
      case 'sparkle': [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, 0.5, { vol: 0.06, delay: i * 0.07 })); break;
      case 'purchase': this.tone(1318, 0.12, { vol: 0.12, type: 'square' }); this.tone(1760, 0.35, { vol: 0.12, type: 'square', delay: 0.1 }); this.burst(0.2, { freq: 5000, q: 3, vol: 0.08, delay: 0.1 }); break;
      case 'horn': this.tone(392, 0.4, { vol: 0.12, type: 'square' }); this.tone(466, 0.4, { vol: 0.08, type: 'square' }); break;
      case 'ingress': this.tone(500, 0.6, { to: 180, vol: 0.12, type: 'triangle' }); this.burst(0.5, { freq: 1200, q: 8, vol: 0.08 }); break;
      case 'bag': this.burst(0.3, { freq: 1500, q: 0.8, vol: 0.12 }); break;
      case 'lid': this.burst(0.08, { freq: 900, vol: 0.2 }); break;
      case 'spoon': this.tone(2400, 0.06, { vol: 0.05 }); this.burst(0.12, { freq: 700, vol: 0.06, delay: 0.05 }); break;
      case 'sleep': this.tone(220, 1.8, { vol: 0.06, attack: 0.5, to: 110 }); break;
      case 'gameover': this.tone(110, 2.4, { to: 40, vol: 0.4, type: 'sawtooth' }); this.burst(2, { freq: 200, type: 'lowpass', vol: 0.3 }); break;
      case 'bird': this.tone(2600 + Math.random() * 900, 0.09, { to: 3400, vol: 0.04 }); this.tone(3000, 0.07, { to: 2400, vol: 0.035, delay: 0.12 }); break;
    }
  },
};

/* ------------------------------------------------------------------ music (streamed <audio>, crossfaded) */
// Tracks: battle-day = Rhythm Scott "Action Drums", battle-night = Rhythm Scott "Full Strength".
// town = Mountain Dreamers "Spirits Over The High Ridge" — the everyday Kapaʻa music (yard + streets + coast, outside fights).
const Music = {
  tracks: { 'battle-day': 'runtime/music/battle-day.mp3', 'battle-night': 'runtime/music/battle-night.mp3', town: 'runtime/music/town.mp3' },
  el: {}, want: null, vol: 0.55, fade: 1.6, enabled: true, unlocked: false,
  get muted() { try { return localStorage.getItem('koa-music') === '0'; } catch (e) { return false; } },
  set muted(v) { try { localStorage.setItem('koa-music', v ? '0' : '1'); } catch (e) { } },
  unlock() { // browsers only allow audio after a gesture: create + prime the elements on the first input
    if (this.unlocked) return; this.unlocked = true;
    for (const k in this.tracks) { const a = new window.Audio(this.tracks[k]); a.loop = true; a.preload = 'auto'; a.volume = 0; this.el[k] = a; }
  },
  set(name) { this.want = name && this.tracks[name] ? name : null; },
  update(dt) {
    if (!this.unlocked) return;
    const target = this.muted ? null : this.want;
    for (const k in this.el) {
      const a = this.el[k], goal = k === target ? this.vol : 0;
      if (goal > 0 && a.paused) { try { const p = a.play(); if (p && p.catch) p.catch(() => { }); } catch (e) { } }
      const step = dt / this.fade * this.vol; a.volume = clamp(goal > a.volume ? Math.min(goal, a.volume + step) : Math.max(goal, a.volume - step), 0, 1);
      if (goal === 0 && a.volume <= 0.001 && !a.paused) a.pause();
    }
  },
  pauseAll() { for (const k in this.el) this.el[k].pause(); },
};

/* ------------------------------------------------------------------ assets */
const Assets = {
  img: {}, meta: window.KOA_META || {}, manifest: window.KOA_MANIFEST || { assets: {} }, loaded: 0, total: 0, errors: [],
  load(done) {
    const want = {};
    const A = this.manifest.assets;
    for (const k of ['bg_night', 'bg_day', 'bg_yard']) if (A[k] && A[k].path) want[k] = A[k].path;
    for (const k in this.meta) {
      const m = this.meta[k];
      if (m.image) want['atlas_' + k] = m._dir + '/' + m.image;
      if (m.tiles) for (const t of m.tiles) want[`tile_${m.district}_${t.row}_${t.col}`] = t.path;
      if (m.image && k in { kben: 1 }) { /* Kalalau Ben is the only Ben sheet used in Act 2 */ }
    }
    // hard guard: obsolete Ben sheets must never load
    for (const k in want) {
      if (/ben-directional-action-atlas|ben-directional-walk-v2/.test(want[k])) { console.error('blocked obsolete asset', want[k]); delete want[k]; }
    }
    const keys = Object.keys(want); this.total = keys.length;
    if (!keys.length) return done();
    keys.forEach(k => {
      const im = new Image();
      im.onload = () => { this.img[k] = im; if (++this.loaded === this.total) done(); };
      im.onerror = () => { this.errors.push(want[k]); if (++this.loaded === this.total) done(); };
      im.src = want[k];
    });
  },
  standin(key) { const a = this.manifest.assets[key]; return !a || a.standin; },
  has(key) { return !!this.meta[key]; },
  frame(key, name) { const m = this.meta[key]; return m && m.frames[name]; },
  anim(key, name) { const m = this.meta[key]; return m && m.animations[name]; },
  // draw a named frame with its pivot at (x,y); scale by target height or factor
  draw(ctx, key, name, x, y, { h = null, s = 1, flip = false, alpha = 1, rot = 0, pivot = null } = {}) {
    const f = this.frame(key, name), im = this.img['atlas_' + key];
    if (!f || !im) return false;
    const [fx, fy, fw, fh] = f.rect; const [px, py] = pivot || f.pivot;
    const k = h ? h / fh : s;
    ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); if (flip) ctx.scale(-1, 1);
    if (alpha !== 1) ctx.globalAlpha *= alpha;
    ctx.drawImage(im, fx, fy, fw, fh, -px * k, -py * k, fw * k, fh * k);
    ctx.restore(); return true;
  },
  animFrame(key, name, t) {
    const a = this.anim(key, name); if (!a) return null;
    const n = a.frames.length; let i = Math.floor(t / a.frame_duration);
    i = a.loop ? i % n : Math.min(i, n - 1);
    return a.frames[i];
  },
};

/* ------------------------------------------------------------------ save */
const Save = {
  KEY: 'koa-save-v4',
  write(data) { try { localStorage.setItem(this.KEY, JSON.stringify(data)); Game.lastSave = data.state + ' @ ' + new Date().toLocaleTimeString(); return true; } catch (e) { return false; } },
  read() { try { const s = localStorage.getItem(this.KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  clear() { try { localStorage.removeItem(this.KEY); } catch (e) { } },
};
