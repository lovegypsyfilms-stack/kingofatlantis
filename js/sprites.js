/* King of Atlantis — character/prop rendering.
 * Each draw* function uses the authoritative processed atlas when runtime/manifest says it exists,
 * otherwise a procedural stand-in with the same palette rules (tan shirt, sandy hair/beard, GOLD crown).
 * Stand-ins never draw a rectangular backdrop. */
'use strict';

const PAL = {
  shirt: '#c8a674', shirtShade: '#a98a5c', shorts: '#5f6a3c', shortsShade: '#4a5330',
  skin: '#e0a57a', skinShade: '#c4865e', hair: '#bf9860', hairShade: '#98733f', beard: '#b48a52',
  crown: '#d4a73a', crownLight: '#f2d27a', crownDark: '#8e6a1e', sandal: '#4a3526', eye: '#2a1c14',
};

/* ---------------- Ben ---------------- */
// dir: index into DIRS; phase: walk time (s); h: on-screen/world height of the figure
function drawBen(ctx, x, y, h, dir, phase, opts = {}) {
  const moving = !!opts.moving;
  if (opts.crownGlow) drawCrownGlow(ctx, x, y - h * 0.93, h, opts.crownGlow);
  if (opts.bag && BAG_OFFSETS[dir].behind) drawBag(ctx, x, y, h, dir, phase, moving);
  const d = DIRS[dir], pose = opts.pose || 'idle';
  const special = pose === 'cast' || pose === 'fall' || pose === 'brace';
  if (Assets.has('ben_v3') && !special) {
    const fr = moving ? Assets.animFrame('ben_v3', 'walk_' + d, phase) : Assets.animFrame('ben_v3', 'idle_' + d, 0);
    shadow(ctx, x, y, h * 0.22);
    Assets.draw(ctx, 'ben_v3', fr, x, y, { h });
  } else if (Assets.has('ben_gold')) {
    // bridge atlas (first-pack motion set recoloured: tan shirt, sandy hair/beard, gold crown)
    let fr, flip = false;
    if (pose === 'cast') { fr = Assets.animFrame('ben_gold', 'cast', opts.poseT || 0); flip = dir >= 5; }
    else if (pose === 'fall') fr = Assets.animFrame('ben_gold', 'fall', opts.poseT || 0);
    else if (pose === 'brace') fr = Assets.animFrame('ben_gold', 'brace', opts.poseT || 0);
    else if (moving) fr = Assets.animFrame('ben_gold', 'walk_' + d, phase);
    else if (dir === 4) fr = Assets.animFrame('ben_gold', 'idle_S', performance.now() / 1000);
    else fr = Assets.animFrame('ben_gold', 'idle_' + d, 0);
    shadow(ctx, x, y, h * 0.22);
    // cast frames face right; mirror when aiming left
    Assets.draw(ctx, 'ben_gold', fr, x, y, { h: pose === 'fall' ? h * 0.9 : h, flip });
  } else {
    drawBenProcedural(ctx, x, y, h, dir, moving ? phase : 0, opts);
  }
  if (opts.bag && !BAG_OFFSETS[dir].behind) drawBag(ctx, x, y, h, dir, phase, moving);
  if (opts.carrot) drawCarrot(ctx, x + (dir >= 5 ? -1 : 1) * h * 0.2, y - h * 0.42, h * 0.16, 0);
}

function shadow(ctx, x, y, r) {
  ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.35, 0, 0, TAU); ctx.fill(); ctx.restore();
}

function drawCrownGlow(ctx, x, y, h, amt) {
  const t = performance.now() / 1000; const r = h * (0.22 + 0.04 * Math.sin(t * 5)) * (0.7 + 0.3 * amt);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
  g.addColorStop(0, `rgba(255,214,110,${0.55 * amt})`); g.addColorStop(0.35, `rgba(240,170,60,${0.28 * amt})`); g.addColorStop(1, 'rgba(240,170,60,0)');
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, TAU); ctx.fill(); ctx.restore();
}

function drawBenProcedural(ctx, x, y, h, dir, phase, opts) {
  const u = h / 100; // unit
  const a = dir * TAU / 8; const dx = Math.sin(a), dy = -Math.cos(a); // facing (dy>0 = toward camera)
  const flip = dx < -0.01; const fx = Math.abs(dx); // draw right-facing, mirror for left
  const front = dy > -0.2, back = dy < -0.4;
  const sw = Math.sin(phase * TAU / 0.56); // stride
  const bob = Math.abs(sw) * 1.6 * u * (phase ? 1 : 0);
  const sitting = opts.pose === 'sit';
  ctx.save(); ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
  shadow(ctx, 0, 0, 26 * u);
  ctx.translate(0, -bob);
  const legY = sitting ? -10 * u : 0;
  // legs + sandals
  const legs = (side) => {
    const off = side * (9 - fx * 5) * u, stride = side * sw * (sitting ? 0 : 7) * u;
    ctx.fillStyle = PAL.skin; ctx.fillRect(off - 4.5 * u + stride * fx, -22 * u + legY, 9 * u, 18 * u - legY);
    ctx.fillStyle = PAL.sandal; ctx.beginPath(); ctx.ellipse(off + stride * fx + fx * 3 * u, -3 * u - stride * (1 - fx) * 0.3, 6 * u, 3.4 * u, 0, 0, TAU); ctx.fill();
  };
  legs(-1); legs(1);
  // shorts
  ctx.fillStyle = PAL.shorts; rr(ctx, -21 * u + fx * 3 * u, -38 * u + legY * 0.3, 42 * u - fx * 6 * u, 19 * u, 5 * u); ctx.fill();
  ctx.fillStyle = PAL.shortsShade; ctx.fillRect(-21 * u + fx * 3 * u, -23 * u, 42 * u - fx * 6 * u, 3 * u);
  // arm behind body
  const armSw = sw * 6 * u;
  const arm = (side, far) => {
    const ax = side * (26 - fx * 16) * u + (far ? -fx * 6 * u : fx * 4 * u), sw2 = side * armSw * (fx > 0.5 ? 1 : 0.5);
    if (opts.pose === 'cast' && !far) return;
    ctx.fillStyle = far ? PAL.skinShade : PAL.skin;
    ctx.beginPath(); ctx.ellipse(ax + sw2 * fx, -46 * u, 6.5 * u, 14 * u, sw2 * 0.02, 0, TAU); ctx.fill();
    ctx.fillStyle = PAL.shirt; ctx.beginPath(); ctx.ellipse(ax + sw2 * fx * 0.3, -57 * u, 7.5 * u, 7 * u, 0, 0, TAU); ctx.fill();
  };
  if (fx > 0.5) arm(-1, true);
  // torso: overweight belly, tan shirt
  const bx = fx * 5 * u;
  ctx.fillStyle = PAL.shirt; ctx.beginPath(); ctx.ellipse(bx * 0.4, -52 * u, (27 - fx * 5) * u, 22 * u, 0, 0, TAU); ctx.fill();
  if (front) { ctx.beginPath(); ctx.ellipse(bx, -44 * u, (22 - fx * 4) * u + fx * 4 * u, 15 * u, 0, 0, TAU); ctx.fill(); }
  ctx.fillStyle = PAL.shirtShade; ctx.beginPath(); ctx.ellipse(bx * 0.4, -33 * u, (23 - fx * 5) * u, 4 * u, 0, 0, Math.PI); ctx.fill();
  if (fx < 0.5) { arm(-1, false); arm(1, false); } else arm(1, false);
  // cast pose: extended arm toward aim handled by caller glow; draw a short raised arm
  if (opts.pose === 'cast') {
    ctx.fillStyle = PAL.skin; ctx.beginPath(); ctx.ellipse(20 * u, -62 * u, 6 * u, 13 * u, -0.9, 0, TAU); ctx.fill();
  }
  // head
  const hx = fx * 5 * u, hy = -80 * u;
  // long sandy hair behind head
  ctx.fillStyle = PAL.hairShade; ctx.beginPath(); ctx.ellipse(hx - fx * 6 * u, hy + 8 * u, 15 * u, 17 * u, 0, 0, TAU); ctx.fill();
  if (!back) {
    ctx.fillStyle = PAL.skin; ctx.beginPath(); ctx.ellipse(hx + fx * 3 * u, hy, 11.5 * u, 13 * u, 0, 0, TAU); ctx.fill();
    // beard (sandy / light brown)
    ctx.fillStyle = PAL.beard; ctx.beginPath();
    ctx.ellipse(hx + fx * 6 * u, hy + 9 * u, (11 - fx * 3) * u, 11 * u, 0, 0, Math.PI); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hx + fx * 6 * u, hy + 12 * u, (9 - fx * 3) * u, 9 * u, 0, 0, TAU); ctx.fill();
    // eyes
    ctx.fillStyle = PAL.eye;
    if (fx < 0.8) { ctx.fillRect(hx - 5 * u + fx * 7 * u, hy - 2 * u, 2.4 * u, 2.4 * u); }
    ctx.fillRect(hx + 3 * u + fx * 5 * u, hy - 2 * u, 2.4 * u, 2.4 * u);
    // hair top / fringe
    ctx.fillStyle = PAL.hair; ctx.beginPath(); ctx.ellipse(hx - fx * 2 * u, hy - 9 * u, 13 * u, 7 * u, 0, Math.PI, TAU); ctx.fill();
    ctx.fillRect(hx - 13 * u - fx * 2 * u, hy - 9 * u, 5 * u, 16 * u);
    if (fx < 0.5) ctx.fillRect(hx + 8 * u, hy - 9 * u, 5 * u, 16 * u);
  } else {
    ctx.fillStyle = PAL.hair; ctx.beginPath(); ctx.ellipse(hx, hy + 2 * u, 14 * u, 16 * u, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = PAL.hairShade; ctx.lineWidth = 1.6 * u;
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(hx + i * 4 * u, hy - 6 * u); ctx.quadraticCurveTo(hx + i * 5 * u + 2 * u, hy + 6 * u, hx + i * 4 * u, hy + 16 * u); ctx.stroke(); }
  }
  // crown — solid aged gold, never cyan
  const cy = hy - 12 * u, cw = 12 * u;
  ctx.fillStyle = PAL.crownDark; ctx.fillRect(hx - cw, cy - 1 * u, cw * 2, 6 * u);
  ctx.fillStyle = PAL.crown; ctx.beginPath(); ctx.moveTo(hx - cw, cy + 4 * u);
  const pts = 5; for (let i = 0; i <= pts; i++) {
    const px = hx - cw + (cw * 2) * i / pts; ctx.lineTo(px, cy - (i % 2 === 0 ? 9 : 4) * u); if (i < pts) ctx.lineTo(px + cw / pts, cy - 1 * u);
  }
  ctx.lineTo(hx + cw, cy + 4 * u); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.crownLight; ctx.fillRect(hx - cw, cy + 0.5 * u, cw * 2, 1.4 * u);
  ctx.fillStyle = '#b3402e'; ctx.beginPath(); ctx.arc(hx + fx * 3 * u, cy + 2 * u, 1.6 * u, 0, TAU); ctx.fill();
  ctx.restore();
}

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// Ben asleep in bed: head/crown on pillow, body a lump under the blanket.
function drawBenAsleep(ctx, x, y, h, breathe) {
  if (Assets.has('ben_gold') && Assets.frame('ben_gold', 'lie_0')) {
    // lying frame (head left) laid along the bed axis so the head rests on the pillow
    const f = Assets.frame('ben_gold', 'lie_0'); const k = (h * 0.78) / f.rect[2];
    ctx.save(); ctx.translate(419 - 345 + x, 365 - 318 + y); ctx.rotate(0.5);
    ctx.scale(1, 1 + breathe * 0.012);
    Assets.draw(ctx, 'ben_gold', 'lie_0', 0, 0, { s: k, pivot: [f.rect[2] / 2, f.rect[3] / 2] });
    ctx.restore(); return;
  }
  h *= 0.62; const u = h / 100;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(55 * u, 56 * u, 72 * u, 26 * u, 0.78, 0, TAU); ctx.fill();
  ctx.fillStyle = PAL.hairShade; ctx.beginPath(); ctx.ellipse(-4 * u, -4 * u, 20 * u, 14 * u, -0.5, 0, TAU); ctx.fill();
  ctx.fillStyle = PAL.skin; ctx.beginPath(); ctx.ellipse(4 * u, 0, 11 * u, 12 * u, -0.5, 0, TAU); ctx.fill();
  ctx.fillStyle = PAL.beard; ctx.beginPath(); ctx.ellipse(12 * u, 7 * u, 10 * u, 8 * u, -0.5, 0, TAU); ctx.fill();
  ctx.fillStyle = PAL.eye; ctx.fillRect(2 * u, -2 * u, 5 * u, 1.2 * u); ctx.fillRect(9 * u, -5 * u, 4 * u, 1.2 * u);
  // crown slipped sideways on pillow, gold
  ctx.save(); ctx.translate(-10 * u, -14 * u); ctx.rotate(-0.9);
  ctx.fillStyle = PAL.crown; ctx.beginPath(); ctx.moveTo(-10 * u, 3 * u);
  for (let i = 0; i <= 4; i++) { ctx.lineTo(-10 * u + i * 5 * u, i % 2 ? -3 * u : -8 * u); }
  ctx.lineTo(10 * u, 3 * u); ctx.closePath(); ctx.fill(); ctx.fillStyle = PAL.crownDark; ctx.fillRect(-10 * u, 1 * u, 20 * u, 3 * u);
  ctx.restore();
  // body lump under blanket (breathing)
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath(); ctx.ellipse(55 * u, 50 * u, 60 * u, (26 + breathe * 2) * u, 0.78, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2 * u; ctx.stroke();
  ctx.restore();
}

/* ---------------- grocery bag (direction-specific offsets) ---------------- */
// Offsets in units of Ben height (x right, y up from feet). 'behind' = drawn before Ben's body.
const BAG_OFFSETS = [
  { x: 0.26, y: 0.33, behind: false }, // N  (back view: bag at his right = screen right)
  { x: 0.24, y: 0.34, behind: true },  // NE
  { x: -0.2, y: 0.34, behind: true }, // E  (right hand on far side; peeks out behind the body)
  { x: -0.18, y: 0.33, behind: false },// SE
  { x: -0.28, y: 0.32, behind: false },// S  (front view: his right = screen left)
  { x: -0.30, y: 0.33, behind: false },// SW
  { x: 0.02, y: 0.33, behind: false }, // W  (right hand near side)
  { x: 0.20, y: 0.33, behind: false }, // NW
];
function drawBag(ctx, x, y, h, dir, phase, moving) {
  const o = BAG_OFFSETS[dir]; const sway = moving ? Math.sin(phase * TAU / 0.56) * h * 0.012 : 0;
  const bx = x + o.x * h + sway, by = y - o.y * h;
  const s = h * 0.24;
  if (Assets.has('props') && Assets.frame('props', 'bag_0')) {
    // directional bag variants from the props sheet: tilted when side-on, swaying upright front/back
    const side = dir === 1 || dir === 2 || dir === 3 ? 'bag_5' : dir === 5 || dir === 6 || dir === 7 ? 'bag_4' : null;
    const nm = side || Assets.animFrame('props', 'bag', moving ? phase * 0.6 : 0);
    Assets.draw(ctx, 'props', nm, bx, by + s * 0.55, { h: s * 1.15 }); return;
  }
  ctx.save(); ctx.translate(bx, by);
  ctx.fillStyle = '#9a6a3a'; ctx.beginPath(); ctx.moveTo(-s * 0.38, -s * 0.1); ctx.lineTo(s * 0.38, -s * 0.1); ctx.lineTo(s * 0.44, s * 0.8); ctx.lineTo(-s * 0.44, s * 0.8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b8844c'; ctx.fillRect(-s * 0.38, -s * 0.1, s * 0.76, s * 0.12);
  ctx.strokeStyle = '#6e4a26'; ctx.lineWidth = Math.max(1, s * 0.03); ctx.beginPath(); ctx.moveTo(-s * 0.1, -s * 0.1); ctx.lineTo(-s * 0.08, s * 0.8); ctx.stroke();
  // groceries peeking out
  ctx.fillStyle = '#4f9a3c'; ctx.beginPath(); ctx.ellipse(-s * 0.15, -s * 0.2, s * 0.12, s * 0.16, -0.3, 0, TAU); ctx.fill();
  ctx.fillStyle = '#e8dcc0'; ctx.fillRect(s * 0.05, -s * 0.34, s * 0.16, s * 0.26);
  ctx.fillStyle = '#e07a2a'; ctx.beginPath(); ctx.moveTo(s * 0.26, -s * 0.12); ctx.lineTo(s * 0.34, -s * 0.42); ctx.lineTo(s * 0.4, -s * 0.12); ctx.fill();
  ctx.restore();
}

/* ---------------- carrot ---------------- */
function drawCarrot(ctx, x, y, s, eaten) {
  if (Assets.has('guinea') && Assets.frame('guinea', 'item_0')) { Assets.draw(ctx, 'guinea', eaten > 0.3 ? 'item_1' : 'item_0', x, y, { h: s * 0.9, rot: -0.3 }); return; }
  const len = s * (1 - eaten * 0.8);
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.5);
  ctx.fillStyle = '#e8792a'; ctx.beginPath(); ctx.moveTo(-s * 0.14, 0); ctx.lineTo(s * 0.14, 0); ctx.lineTo(0, len); ctx.closePath(); ctx.fill();
  if (eaten < 0.9) { ctx.fillStyle = '#4c9a3a'; ctx.beginPath(); ctx.ellipse(-s * 0.06, -s * 0.12, s * 0.05, s * 0.16, -0.3, 0, TAU); ctx.ellipse(s * 0.06, -s * 0.12, s * 0.05, s * 0.16, 0.3, 0, TAU); ctx.fill(); }
  ctx.restore();
}

/* ---------------- guinea pig ---------------- */
// state: 'idle' | 'run' | 'eat' ; frame for eat 0..2 ; facing +1 right / -1 left
function drawGuineaPig(ctx, x, y, s, state, t, facing, eatFrame = 0, alert = false) {
  if (Assets.has('guinea')) {
    let name, flip = false;
    if (state === 'eat') { name = Assets.anim('guinea', 'eat').frames[Math.min(eatFrame, 2)]; flip = facing < 0; }
    else if (state === 'run') name = Assets.animFrame('guinea', facing < 0 ? 'run_W' : 'run_E', t);
    else if (alert) { name = Assets.animFrame('guinea', 'alert', 0); flip = facing < 0; }
    else { name = Assets.animFrame('guinea', 'idle', 0); flip = facing < 0; }
    const tall = state === 'eat' || alert;
    if (name) { shadow(ctx, x, y, s * 0.45); Assets.draw(ctx, 'guinea', name, x, y, { h: s * (tall ? 1.05 : 0.72), flip }); return; }
  }
  const hop = state === 'run' ? Math.abs(Math.sin(t * 18)) * s * 0.06 : 0;
  ctx.save(); ctx.translate(x, y); ctx.scale(facing, 1);
  shadow(ctx, 0, 0, s * 0.5);
  ctx.translate(0, -hop);
  // feet
  ctx.fillStyle = '#e8b8a0'; [-0.25, 0.2].forEach(k => { ctx.beginPath(); ctx.ellipse(k * s, -s * 0.03, s * 0.07, s * 0.04, 0, 0, TAU); ctx.fill(); });
  // body: tricolour
  ctx.fillStyle = '#f4ede0'; ctx.beginPath(); ctx.ellipse(0, -s * 0.24, s * 0.48, s * 0.26, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#c47a36'; ctx.beginPath(); ctx.ellipse(-s * 0.2, -s * 0.3, s * 0.26, s * 0.2, 0.2, 0, TAU); ctx.fill();
  ctx.fillStyle = '#3a2a20'; ctx.beginPath(); ctx.ellipse(-s * 0.36, -s * 0.22, s * 0.12, s * 0.12, 0, 0, TAU); ctx.fill();
  // head
  const chew = state === 'eat' ? Math.sin(t * 30) * s * 0.015 : 0;
  ctx.fillStyle = '#c47a36'; ctx.beginPath(); ctx.ellipse(s * 0.34, -s * 0.28, s * 0.2, s * 0.18, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#f4ede0'; ctx.beginPath(); ctx.ellipse(s * 0.44, -s * 0.22 + chew, s * 0.1, s * 0.09, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#8a4a24'; ctx.beginPath(); ctx.ellipse(s * 0.24, -s * 0.44, s * 0.07, s * 0.05, -0.4, 0, TAU); ctx.fill();
  ctx.fillStyle = '#1a1010'; ctx.beginPath(); ctx.arc(s * 0.38, -s * 0.33, s * 0.035, 0, TAU); ctx.fill();
  ctx.fillStyle = '#e89a9a'; ctx.beginPath(); ctx.arc(s * 0.53, -s * 0.25, s * 0.02, 0, TAU); ctx.fill();
  if (state === 'eat') drawCarrot(ctx, s * 0.6, -s * 0.28, s * 0.4, eatFrame / 2.2);
  ctx.restore();
}

/* ---------------- ice cream tub ---------------- */
// stage 0 closed, 1 open full, 2 half, 3 empty
function drawIceCream(ctx, x, y, s, stage, spoonT = -1) {
  if (Assets.has('props') && Assets.frame('props', 'icecream_0')) {
    // closed -> open full -> scraped half -> set aside with lid; spoon animates separately while eating
    const pn = ['icecream_0', spoonT >= 0 ? 'icecream_1' : 'icecream_4', 'icecream_2', 'icecream_5'][stage];
    Assets.draw(ctx, 'props', pn, x, y - s * 0.4, { h: s * 0.8 });
    if (spoonT >= 0) { const lift = Math.sin(spoonT * Math.PI) * s * 0.9; Assets.draw(ctx, 'props', 'icecream_3', x + s * 0.25, y - s * 0.95 - lift, { h: s * 0.8, rot: 0.2 - Math.sin(spoonT * Math.PI) * 0.5 }); }
    return;
  }
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#f4f0e8'; ctx.beginPath(); ctx.moveTo(-s * 0.4, -s * 0.8); ctx.lineTo(s * 0.4, -s * 0.8); ctx.lineTo(s * 0.34, 0); ctx.lineTo(-s * 0.34, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d9607a'; ctx.fillRect(-s * 0.37, -s * 0.52, s * 0.74, s * 0.22);
  ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(6, s * 0.14)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('VANILLA', 0, -s * 0.36);
  if (stage === 0) { ctx.fillStyle = '#d9607a'; ctx.beginPath(); ctx.ellipse(0, -s * 0.82, s * 0.44, s * 0.12, 0, 0, TAU); ctx.fill(); }
  else {
    ctx.fillStyle = '#5a4030'; ctx.beginPath(); ctx.ellipse(0, -s * 0.8, s * 0.4, s * 0.1, 0, 0, TAU); ctx.fill();
    const lvl = [0, 1, 0.5, 0][stage];
    if (lvl > 0) { ctx.fillStyle = '#fbf2d6'; ctx.beginPath(); ctx.ellipse(0, -s * 0.8, s * 0.38 * (0.5 + lvl * 0.5), s * 0.09 * (0.5 + lvl * 0.5), 0, 0, TAU); ctx.fill(); }
  }
  if (spoonT >= 0) {
    const lift = Math.sin(spoonT * Math.PI) * s * 0.9;
    ctx.strokeStyle = '#c8ccd2'; ctx.lineWidth = Math.max(1.5, s * 0.06); ctx.beginPath();
    ctx.moveTo(s * 0.1, -s * 0.8 - lift); ctx.lineTo(s * 0.5, -s * 1.3 - lift); ctx.stroke();
    ctx.fillStyle = '#c8ccd2'; ctx.beginPath(); ctx.ellipse(s * 0.08, -s * 0.78 - lift, s * 0.09, s * 0.06, 0.6, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/* ---------------- lesser entities (4 types) ---------------- */
const LESSER_TYPES = [
  { id: 1, name: 'wisp-shade', hp: 1, speed: 175, size: 190, frame: 'shade_s', tint: null, weave: 70, radius: 70 },
  { id: 2, name: 'claw-shade', hp: 1, speed: 145, size: 250, frame: 'shade_m', tint: 'rgba(90,60,200,0.35)', weave: 40, radius: 85 },
  { id: 3, name: 'stalker', hp: 2, speed: 125, size: 270, frame: 'shade_m', tint: 'rgba(30,160,170,0.35)', weave: 0, stalk: true, radius: 90 },
  { id: 4, name: 'brute', hp: 3, speed: 92, size: 360, frame: 'shade_l', tint: 'rgba(160,40,120,0.3)', weave: 20, radius: 115 },
];
function drawLesser(ctx, e, t) {
  const T = e.type; const key = 'entity' + T.id;
  let name = null;
  if (Assets.has('lesser')) {
    name = e.dying ? Assets.animFrame('lesser', key + '_dissolve', e.dieT) : e.hitT > 0 ? Assets.animFrame('lesser', key + '_hit', 0) : Assets.animFrame('lesser', key + '_move', t);
    if (name) { Assets.draw(ctx, 'lesser', name, e.x, e.y, { h: T.size, alpha: e.alpha, flip: e.vx < 0 }); return; }
  }
  // stand-in: shadow figures from the retained VFX atlas (already alpha-clean), tinted per type
  const f = Assets.frame('vfx', T.frame); if (!f) return;
  const k = T.size / f.rect[3];
  const wob = Math.sin(t * 3 + e.seed) * 0.05;
  ctx.save(); ctx.globalAlpha = e.alpha;
  ctx.translate(e.x, e.y); ctx.rotate(wob); if (e.vx < 0) ctx.scale(-1, 1);
  if (e.hitT > 0) { ctx.translate((Math.random() - 0.5) * 12, 0); }
  const im = Assets.img.atlas_vfx; const [fx, fy, fw, fh] = f.rect;
  ctx.drawImage(im, fx, fy, fw, fh, -fw * k / 2, -fh * k / 2, fw * k, fh * k);
  if (T.tint || e.hitT > 0) {
    // tint only the sprite pixels (source-atop on an isolated layer)
    const lay = tintLayer(im, f.rect, e.hitT > 0 ? 'rgba(255,240,200,0.7)' : T.tint);
    ctx.drawImage(lay, -fw * k / 2, -fh * k / 2, fw * k, fh * k);
  }
  ctx.restore();
}
const _tintCache = new Map();
function tintLayer(im, rect, color) {
  const key = rect.join(',') + color; if (_tintCache.has(key)) return _tintCache.get(key);
  const c = document.createElement('canvas'); c.width = rect[2]; c.height = rect[3]; const x = c.getContext('2d');
  x.drawImage(im, rect[0], rect[1], rect[2], rect[3], 0, 0, rect[2], rect[3]);
  x.globalCompositeOperation = 'source-atop'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  _tintCache.set(key, c); return c;
}

/* ---------------- boss demon (one coherent creature) ---------------- */
// stage = hits taken (0..5); heading = flight direction angle; flap = wing phase; lean = 0..1 inward lean
function drawDemon(ctx, x, y, size, stage, heading, flap, opts = {}) {
  if (Assets.has('demon')) {
    // clean: 8 directional flight frames; hits 1-4: the sheet's fracture stages; lunge + death frames
    const left = Math.cos(heading) < 0; let nm, flip = false;
    if (opts.dying) { const d = Assets.anim('demon', 'death'); nm = d.frames[Math.min(d.frames.length - 1, Math.floor((opts.dieT || 0) / 0.6))]; }
    else if (opts.lunging) { nm = 'lunge_0'; flip = left; }
    else if (stage > 0) { nm = 'fracture_' + Math.min(stage, 4); flip = left; }
    else { const an = Assets.anim('demon', 'fly_' + DIRS[dirFromVec(Math.cos(heading), Math.sin(heading))]); nm = an && an.frames[0]; }
    if (Assets.frame('demon', nm)) {
      const bob = Math.sin(flap * 4) * size * 0.02;
      if (opts.flare) { const g = ctx.createRadialGradient(x, y, 10, x, y, size * 0.6); g.addColorStop(0, `rgba(255,140,40,${0.35 * opts.flare})`); g.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, size * 0.6, 0, TAU); ctx.fill(); ctx.restore(); }
      Assets.draw(ctx, 'demon', nm, x, y + bob, { h: opts.lunging ? size * 0.9 : size, flip, alpha: (opts.alpha ?? 1) * (stage >= 4 && !opts.dying ? 0.8 + 0.2 * Math.sin(performance.now() / 45) : 1) });
      return;
    }
  }
  const s = size / 100; const facingLeft = Math.cos(heading) < 0;
  const tilt = clamp(Math.sin(heading) * 0.25, -0.3, 0.3) * (facingLeft ? -1 : 1);
  const t = performance.now() / 1000;
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha *= (opts.alpha ?? 1);
  if (stage >= 4 && !opts.dying) ctx.globalAlpha *= 0.75 + 0.25 * Math.sin(t * 23);
  if (facingLeft) ctx.scale(-1, 1); ctx.rotate(tilt);
  // aura
  const g = ctx.createRadialGradient(0, 0, 5 * s, 0, 0, 70 * s);
  g.addColorStop(0, 'rgba(120,20,90,0.35)'); g.addColorStop(1, 'rgba(40,0,40,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 70 * s, 0, TAU); ctx.fill();
  // wings (flight frames: flap cycle)
  const w = Math.sin(flap * TAU * 1.4);
  const wing = (side) => {
    ctx.save(); ctx.scale(side, 1); ctx.rotate(-0.25 + w * 0.45 * side * side);
    ctx.fillStyle = '#1c0f24'; ctx.beginPath(); ctx.moveTo(6 * s, -8 * s);
    ctx.quadraticCurveTo(40 * s, -48 * s - w * 10 * s, 64 * s, -30 * s - w * 16 * s);
    ctx.lineTo(56 * s, -12 * s); ctx.lineTo(62 * s, 2 * s - w * 6 * s); ctx.lineTo(46 * s, 4 * s); ctx.lineTo(44 * s, 18 * s - w * 4 * s);
    ctx.quadraticCurveTo(24 * s, 8 * s, 6 * s, 10 * s); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(160,60,160,0.5)'; ctx.lineWidth = 1.5 * s; ctx.stroke();
    ctx.restore();
  };
  wing(-1); wing(1);
  // body
  ctx.fillStyle = '#26142e'; ctx.beginPath(); ctx.ellipse(0, 4 * s, 17 * s, 26 * s, 0, 0, TAU); ctx.fill();
  // tail
  ctx.strokeStyle = '#26142e'; ctx.lineWidth = 5 * s; ctx.beginPath(); ctx.moveTo(-4 * s, 26 * s);
  ctx.quadraticCurveTo(-24 * s, 44 * s + Math.sin(t * 4) * 6 * s, -10 * s, 56 * s); ctx.stroke();
  // arms/claws reaching forward (more when lunging)
  const reach = opts.lunging ? 1 : opts.lean || 0;
  ctx.lineWidth = 4.5 * s; ctx.beginPath(); ctx.moveTo(10 * s, -6 * s); ctx.quadraticCurveTo(28 * s + reach * 10 * s, 4 * s, 30 * s + reach * 18 * s, 18 * s); ctx.stroke();
  // head + horns
  ctx.fillStyle = '#2e1838'; ctx.beginPath(); ctx.ellipse(6 * s, -26 * s, 12 * s, 11 * s, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#140a18';
  [[-1, 0], [1, 6]].forEach(([k, o]) => { ctx.beginPath(); ctx.moveTo(o * s + k * 3 * s, -34 * s); ctx.quadraticCurveTo(o * s + k * 14 * s, -52 * s, o * s + k * 4 * s, -62 * s); ctx.quadraticCurveTo(o * s + k * 8 * s, -48 * s, o * s + k * 9 * s - k * 6 * s, -32 * s); ctx.fill(); });
  // eyes (flare during telegraph)
  const flare = opts.flare || 0;
  ctx.fillStyle = `rgba(255,${160 - flare * 100},${60 - flare * 40},1)`; ctx.shadowColor = '#ff8a2a'; ctx.shadowBlur = (8 + flare * 20) * s;
  ctx.beginPath(); ctx.ellipse(10 * s, -27 * s, 2.6 * s * (1 + flare), 1.6 * s, 0.2, 0, TAU); ctx.ellipse(16 * s, -26 * s, 2.2 * s * (1 + flare), 1.4 * s, 0.2, 0, TAU); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
  drawFractures(ctx, x, y, size, stage, opts, facingLeft, tilt);
}

// five visible fracture stages instead of a health bar
function drawFractures(ctx, x, y, size, stage, opts, flipped = false, tilt = 0) {
  if (stage <= 0) return;
  const s = size / 100, t = performance.now() / 1000;
  ctx.save(); ctx.translate(x, y); if (flipped) ctx.scale(-1, 1); ctx.rotate(tilt);
  ctx.globalCompositeOperation = 'lighter';
  const cracks = [
    [[2, -30], [8, -18], [4, -6], [12, 6]],
    [[-8, -10], [0, 0], [-6, 14], [2, 24]],
    [[14, -20], [22, -10], [16, 4], [26, 12]],
    [[-12, 6], [-20, 16], [-12, 26], [-18, 36]],
    [[0, -40], [6, -30], [-4, -22], [10, -12]],
  ];
  const glow = 0.5 + 0.5 * Math.sin(t * (6 + stage * 3));
  for (let i = 0; i < Math.min(stage, 5); i++) {
    const c = cracks[i];
    ctx.strokeStyle = `rgba(255,${200 - i * 25},${120 - i * 20},${0.55 + 0.4 * glow})`;
    ctx.lineWidth = (1.6 + i * 0.5 + (stage >= 3 ? 1 : 0)) * s; ctx.shadowColor = '#ffb24a'; ctx.shadowBlur = (6 + stage * 3) * s;
    ctx.beginPath(); ctx.moveTo(c[0][0] * s, c[0][1] * s); for (const p of c.slice(1)) ctx.lineTo(p[0] * s, p[1] * s); ctx.stroke();
  }
  if (stage >= 3) { // bright wound
    const g = ctx.createRadialGradient(4 * s, 0, 0, 4 * s, 0, 22 * s * (stage >= 4 ? 1.4 : 1));
    g.addColorStop(0, `rgba(255,220,150,${0.5 + 0.3 * glow})`); g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(4 * s, 0, 30 * s, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
