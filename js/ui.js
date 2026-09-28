// Screens and touch controls. All rules live in engine.js / ai.js.
import { key, fromKey, toPixel, offsetToAxial, distance, neighbors, ray } from './hex.js';
import { makeRng } from './rng.js';
import {
  player, enemies, alive, has, reachable, moveAlong, startPlayerTurn, endPlayerTurn,
  canQuick, canFull, spendQuick, spendFull, weaponTargets, weaponAvailable, lineTargets,
  fireWeapon, attackPreview, throwGrenade, placeMine, overcharge, useInitiative, activateCore,
  projectShield, stabilize, checkObjective, inBounds, passable, OVERCHARGE_HEAT, inZone,
} from './engine.js';
import { enemyPhase } from './ai.js';
import { generateMission } from './missions.js';
import { PILOT, MECH, PLAYER_WEAPONS, SYSTEMS, FRAME_TEXT, QUIPS } from './data.js';

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const HEX = 30;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (p) => `${Math.round(p * 100)}%`;

// ------------------------------------------------------------ progress

const STORE = 'lancerweb.v1';
function loadProgress() {
  try {
    return { mission: 1, best: 0, runs: 1, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
  } catch { return { mission: 1, best: 0, runs: 1 }; }
}
function saveProgress(p) {
  try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* private mode */ }
}
let progress = loadProgress();

// ------------------------------------------------------------ modal

function ask(question, options) {
  return new Promise((resolve) => {
    $modal.innerHTML = `<div class="sheet"><p>${esc(question)}</p>${options
      .map((o, i) => `<button data-i="${i}" class="${i === 0 ? 'primary' : ''}">${esc(o.label)}${o.detail ? `<small>${esc(o.detail)}</small>` : ''}</button>`)
      .join('')}</div>`;
    $modal.hidden = false;
    $modal.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      $modal.hidden = true;
      $modal.onclick = null;
      resolve(options[+b.dataset.i].value);
    };
  });
}

// ------------------------------------------------------------ hangar

export function showHangar() {
  const n = progress.mission;
  $app.innerHTML = `
  <div class="screen">
    <div class="row spread"><h1>BULKHEAD</h1><span class="muted small">Lancer solo · LL${PILOT.ll}</span></div>
    <div class="card">
      <h3>Pilot</h3>
      <h2>${esc(PILOT.name)} “${esc(PILOT.callsign)}”</h2>
      <div class="muted small">Grit +${PILOT.grit} · Hull ${PILOT.hase.hull} · Agi ${PILOT.hase.agi} · Sys ${PILOT.hase.sys} · Eng ${PILOT.hase.eng}</div>
      <ul class="plain small">${PILOT.talents.map((t) => `<li><b>${esc(t.name)}</b><br>${esc(t.text)}</li>`).join('')}</ul>
    </div>
    <div class="card">
      <h3>Mech</h3>
      <h2>${esc(MECH.name)} <span class="muted small">${esc(MECH.frame)}</span></h2>
      <div class="stats">
        <div><b>${MECH.maxHp}</b><span>HP</span></div>
        <div><b>${MECH.evasion}</b><span>Evasion</span></div>
        <div><b>${MECH.speed}</b><span>Speed</span></div>
        <div><b>${MECH.heatCap}</b><span>Heat cap</span></div>
        <div><b>${MECH.structure}</b><span>Structure</span></div>
        <div><b>${MECH.stress}</b><span>Stress</span></div>
        <div><b>${MECH.armor}</b><span>Armor</span></div>
        <div><b>${MECH.repairs}</b><span>Repairs</span></div>
      </div>
      <ul class="plain small">
        ${Object.values(PLAYER_WEAPONS).map((w) => `<li><b>${esc(w.name)}</b> — ${esc(w.note)}</li>`).join('')}
        ${SYSTEMS.map((x) => `<li><b>${esc(x.name)}</b> — ${esc(x.text)}</li>`).join('')}
        <li><b>Everest</b> — ${esc(FRAME_TEXT.initiative)}</li>
        <li><b>Core</b> — ${esc(FRAME_TEXT.core)}</li>
      </ul>
    </div>
    <div class="card">
      <div class="row spread"><h3>Campaign</h3><span class="muted small">Best: ${progress.best} win${progress.best === 1 ? '' : 's'}</span></div>
      <h2>Next: Mission ${n}</h2>
      <div class="muted small">Full repair before every mission. Lose once and the run starts over at Mission 1.</div>
      <button class="primary big-cta" id="go">Deploy</button>
    </div>
    ${rulesHtml()}
    ${n > 1 ? '<button class="ghost danger" id="reset">Abandon run (back to Mission 1)</button>' : ''}
    <div class="muted small">Lancer is © Massif Press. Unofficial fan tool under the Lancer Third Party License.</div>
  </div>`;
  document.getElementById('go').onclick = () => showBriefing(n);
  const r = document.getElementById('reset');
  if (r) r.onclick = async () => {
    const ok = await ask('Abandon this run and start over at Mission 1?', [
      { value: false, label: 'Keep going' }, { value: true, label: 'Abandon run' }]);
    if (ok) { progress.mission = 1; progress.runs += 1; saveProgress(progress); showHangar(); }
  };
}

function rulesHtml() {
  return `<details class="card"><summary>How to play (quick rules)</summary>
    <ul>
      <li><b>Your turn:</b> one standard <b>Move</b> plus two <b>quick</b> actions, or one <b>full</b> action. You can't take the same action twice unless you Overcharge.</li>
      <li><b>Attacks:</b> d20 + Grit vs Evasion. Accuracy adds the highest of some d6s, Difficulty subtracts it. They cancel each other out. A 20+ is a crit, which rolls damage twice and keeps the best.</li>
      <li><b>Cover:</b> a wall right next to the target, between it and the shooter, is hard cover (+2 Difficulty). Melee ignores cover.</li>
      <li><b>Engaged:</b> being next to an enemy stops your movement and gives your ranged attacks +1 Difficulty. Moving away from an enemy's melee Threat provokes Overwatch unless you Disengage.</li>
      <li><b>Heat:</b> going past your heat cap costs 1 Stress and you roll on the Overheating table. Stabilize vents all heat.</li>
      <li><b>Damage:</b> at 0 HP you lose 1 Structure, roll on the Structure table and your HP refills. Losing all 4 Structure destroys the mech.</li>
      <li><b>Brace:</b> when a hit would cost you structure, you can Brace to halve it. Next turn you only get one quick action.</li>
      <li><b>Overwatch:</b> fires automatically with the Blade (Threat 1) or Shotgun (Threat 3) when an enemy starts moving inside your Threat. You get one reaction per round.</li>
      <li>Tap an enemy to see its stats.</li>
    </ul></details>`;
}

// ------------------------------------------------------------ briefing

let mission = null;

function showBriefing(n) {
  const seed = (Date.now() ^ (n * 2654435761)) >>> 0;
  mission = generateMission(n, makeRng(seed));
  const rng = makeRng(seed + 1);
  $app.innerHTML = `
  <div class="screen">
    <h3>Mission ${n}${mission.tier > 1 ? ` · Tier ${mission.tier} opposition` : ''}</h3>
    <h1>${esc(mission.name)}</h1>
    <div class="card">
      <h3>Objective</h3>
      <div>${esc(mission.brief)}</div>
      <h3>Expected hostiles</h3>
      <div>${esc(mission.summary)}</div>
    </div>
    <div class="quote">Vail: “${esc(rng.pick(QUIPS.start))}”</div>
    <button class="primary big-cta" id="launch">Launch</button>
    <button class="ghost" id="back">Back to hangar</button>
  </div>`;
  document.getElementById('launch').onclick = () => startCombat();
  document.getElementById('back').onclick = () => showHangar();
}

// ------------------------------------------------------------ combat

let s = null;
let ui = null;
let logLines = [];
let logOpen = false;

const io = {
  log(text, kind = 'info') {
    logLines.push({ text, kind });
    if (logLines.length > 400) logLines.shift();
    renderLog();
  },
  ask,
  pause(ms) {
    render();
    return new Promise((r) => setTimeout(r, ms));
  },
};

function startCombat() {
  s = mission.state;
  logLines = [];
  ui = { mode: 'idle', busy: false };
  $app.innerHTML = `
    <div class="topbar"><div><b id="t-title"></b><div class="obj" id="t-obj"></div></div><button class="ghost small" id="t-menu">☰</button></div>
    <div class="mapwrap"><svg class="map" id="map"></svg></div>
    <div class="status" id="status"></div>
    <div class="panel" id="panel"></div>
    <div class="log" id="log"></div>`;
  document.getElementById('map').addEventListener('click', onMapTap);
  document.getElementById('log').onclick = () => { logOpen = !logOpen; renderLog(); };
  document.getElementById('t-menu').onclick = menu;
  io.log(`— ${mission.name} — ${mission.brief}`, 'turn');
  beginPlayerTurn();
}

async function menu() {
  const v = await ask('Menu', [
    { value: 'close', label: 'Resume' },
    { value: 'ow', label: `Auto-Overwatch: ${s.settings.autoOverwatch ? 'ON' : 'OFF'}`, detail: 'Toggle whether Vail automatically uses his reaction to Overwatch.' },
    { value: 'quit', label: 'Retreat (counts as a loss)' },
  ]);
  if (v === 'ow') { s.settings.autoOverwatch = !s.settings.autoOverwatch; render(); }
  if (v === 'quit') {
    const ok = await ask('Retreat? The run ends and you start over at Mission 1.', [
      { value: false, label: 'Stay and fight' }, { value: true, label: 'Retreat' }]);
    if (ok) { s.over = 'lose'; finish(); }
  }
}

function beginPlayerTurn() {
  startPlayerTurn(s, io);
  io.log(`Round ${s.round} — your turn`, 'turn');
  ui = { mode: 'idle', busy: false };
  const p = player(s);
  if (has(p, 'stunned')) ui.mode = 'stunned';
  render();
}

async function run(fn) {
  if (ui.busy) return;
  ui.busy = true;
  render();
  try {
    await fn();
  } finally {
    ui.busy = false;
  }
  if (s.over || checkObjective(s, io)) return finish();
  render();
}

async function endTurn() {
  await run(async () => {
    ui.mode = 'idle';
    endPlayerTurn(s, io);
    if (checkObjective(s, io)) return;
    io.log('Enemy turn', 'turn');
    await enemyPhase(s, io, { delay: 380 });
  });
  if (!s.over) beginPlayerTurn();
}

function finish() {
  render();
  const win = s.over === 'win';
  const n = mission.n;
  if (win) {
    progress.mission = n + 1;
    progress.best = Math.max(progress.best, n);
  } else {
    progress.mission = 1;
    progress.runs += 1;
  }
  saveProgress(progress);
  setTimeout(() => {
    ask(
      win ? `Mission ${n} complete. ${s.kills} kill${s.kills === 1 ? '' : 's'} in ${s.round} round${s.round === 1 ? '' : 's'}.`
        : `Mission ${n} failed. The run is over — best streak: ${progress.best}.`,
      win ? [{ value: 'next', label: `Next: Mission ${n + 1}` }, { value: 'hangar', label: 'Hangar' }]
        : [{ value: 'hangar', label: 'Back to hangar' }],
    ).then((v) => (v === 'next' ? showBriefing(n + 1) : showHangar()));
  }, 500);
}

// ------------------------------------------------------------ map

function hexPoints(c) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(c.x + HEX * Math.cos(a)).toFixed(1)},${(c.y + HEX * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function allHexes() {
  const out = [];
  for (let row = 0; row < s.height; row++) for (let col = 0; col < s.width; col++) out.push(offsetToAxial(col, row));
  return out;
}

function highlight() {
  const p = player(s);
  const h = { reach: new Set(), target: new Set(), aoe: new Set(), pick: new Set() };
  if (ui.mode === 'move') for (const k of ui.reach.keys()) h.reach.add(k);
  if (ui.mode === 'target') {
    for (const t of weaponTargets(s, ui.weapon)) h.target.add(key(t.pos));
    if (ui.pending) {
      h.pick.add(key(ui.pending.pos));
      if (ui.weapon === 'pistols') for (const x of ray(p.pos, ui.pending.pos, 5)) if (inBounds(s, x)) h.aoe.add(key(x));
    }
  }
  if (ui.mode === 'grenade') {
    for (const x of allHexes()) if (distance(x, p.pos) <= 5 && distance(x, p.pos) > 0) h.reach.add(key(x));
    if (ui.pendingHex) {
      h.pick.add(key(ui.pendingHex));
      for (const x of [ui.pendingHex, ...neighbors(ui.pendingHex)]) h.aoe.add(key(x));
    }
  }
  if (ui.mode === 'mine') for (const x of neighbors(p.pos)) if (passable(s, x) && !s.mines.some((m) => key(m.pos) === key(x))) h.reach.add(key(x));
  if (ui.mode === 'shield') for (const e of enemies(s)) h.target.add(key(e.pos));
  return h;
}

function renderMap() {
  const svg = document.getElementById('map');
  if (!svg) return;
  const hexes = allHexes();
  const px = hexes.map((h) => toPixel(h, HEX));
  const minX = Math.min(...px.map((c) => c.x)) - HEX, maxX = Math.max(...px.map((c) => c.x)) + HEX;
  const minY = Math.min(...px.map((c) => c.y)) - HEX, maxY = Math.max(...px.map((c) => c.y)) + HEX;
  svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
  const hl = highlight();
  let out = '';
  hexes.forEach((h, i) => {
    const k = key(h);
    const cls = ['hex'];
    if (s.terrain.has(k)) cls.push('cover');
    else if (hl.aoe.has(k)) cls.push('aoe');
    else if (hl.target.has(k)) cls.push('target');
    else if (hl.reach.has(k)) cls.push('reach');
    else if (s.zone.has(k)) cls.push('zone');
    if (hl.pick.has(k)) cls.push('pick');
    out += `<polygon class="${cls.join(' ')}" data-k="${k}" points="${hexPoints(px[i])}"/>`;
    if (s.terrain.has(k)) {
      const c = px[i];
      out += `<rect class="wall" x="${c.x - 11}" y="${c.y - 7}" width="22" height="14" rx="2" pointer-events="none"/>`;
    }
  });
  for (const m of s.mines) {
    const c = toPixel(m.pos, HEX);
    out += `<rect class="mine" x="${c.x - 6}" y="${c.y + 10}" width="12" height="12" transform="rotate(45 ${c.x} ${c.y + 16})" pointer-events="none"/>`;
  }
  for (const u of s.units) {
    if (!alive(u)) continue;
    const c = toPixel(u.pos, HEX);
    const cls = ['unit', u.side];
    if (u.elite) cls.push('elite');
    if (ui.selected === u.id) cls.push('selected');
    const r = HEX * 0.62;
    const hpw = 30 * Math.max(0, u.hp) / u.maxHp;
    out += `<g class="${cls.join(' ')}" pointer-events="none">
      <circle class="body" cx="${c.x}" cy="${c.y}" r="${r}"/>
      <text x="${c.x}" y="${c.y - 1}" font-size="${u.side === 'player' ? 17 : 15}">${esc(u.letter)}</text>
      <rect class="hpbar-bg" x="${c.x - 15}" y="${c.y + r - 2}" width="30" height="5" rx="2"/>
      <rect class="hpbar" x="${c.x - 15}" y="${c.y + r - 2}" width="${hpw}" height="5" rx="2"/>
      ${u.commander ? `<text class="star" x="${c.x + r}" y="${c.y - r}">★</text>` : ''}
      ${u.structure > 1 && u.side === 'enemy' ? `<text x="${c.x - r}" y="${c.y - r}" font-size="10" fill="#ff9ea1">${u.structure}</text>` : ''}
    </g>`;
  }
  svg.innerHTML = out;
}

function onMapTap(e) {
  const poly = e.target.closest('polygon');
  if (!poly || ui.busy || s.over) return;
  const h = fromKey(poly.dataset.k);
  const k = poly.dataset.k;
  const u = s.units.find((x) => alive(x) && key(x.pos) === k);
  const p = player(s);

  if (ui.mode === 'move') {
    const o = ui.reach.get(k);
    if (o) {
      const kind = ui.moveKind;
      run(async () => {
        const t = s.turn;
        if (kind === 'move') t.moved = true;
        else if (p.coreActive && !t.freeBoostUsed && !t.noFree) t.freeBoostUsed = true;
        else spendQuick(s, 'boost');
        t.protocolsOpen = false;
        ui.mode = 'idle';
        await moveAlong(s, io, p, o.path, { disengage: s.turn.disengage });
      });
    } else { ui.mode = 'idle'; render(); }
    return;
  }
  if (ui.mode === 'target') {
    if (u && u.side === 'enemy' && weaponTargets(s, ui.weapon).some((t) => t.id === u.id)) { ui.pending = u; render(); }
    return;
  }
  if (ui.mode === 'grenade') {
    if (distance(h, p.pos) <= 5 && distance(h, p.pos) > 0) { ui.pendingHex = h; render(); }
    return;
  }
  if (ui.mode === 'mine') {
    if (highlight().reach.has(k)) {
      run(async () => { spendQuick(s, 'hex'); placeMine(s, io, h); ui.mode = 'idle'; });
    }
    return;
  }
  if (ui.mode === 'shield') {
    if (u && u.side === 'enemy') {
      run(async () => { s.turn.shieldUsed = true; await projectShield(s, io, u); ui.mode = 'idle'; });
    }
    return;
  }
  // idle: inspect units
  ui.selected = u ? u.id : null;
  ui.mode = u && u.side === 'enemy' ? 'inspect' : ui.mode === 'stunned' ? 'stunned' : 'idle';
  render();
}

// ------------------------------------------------------------ panels

function render() {
  if (!s || !document.getElementById('map')) return;
  const o = s.objective;
  document.getElementById('t-title').textContent = `M${mission.n} · ${mission.name.replace('Operation ', '')} · Round ${s.round}`;
  let obj = mission.brief;
  if (o.type === 'hold') obj = `Hold zone: ${o.holdCount}/${o.holdNeeded} rounds${inZone(s, player(s)) ? ' (in zone)' : ''} · ${enemies(s).length} hostiles`;
  if (o.type === 'eliminate') obj = `Destroy all hostiles · ${enemies(s).length} left`;
  if (o.type === 'assassinate') obj = 'Destroy the Commander ★';
  document.getElementById('t-obj').textContent = obj;
  renderMap();
  renderStatus();
  renderPanel();
  renderLog();
}

function renderStatus() {
  const p = player(s);
  const pips = (n, max) => `<span class="pips">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? '' : 'off'}"></i>`).join('')}</span>`;
  const badges = [];
  const st = { impaired: 'Impaired', stunned: 'Stunned', exposed: 'Exposed', lockon: 'Lock On', braced: 'Braced' };
  for (const [k, v] of Object.entries(st)) if (has(p, k)) badges.push(`<span class="badge bad">${v}</span>`);
  if (p.coreActive) badges.push('<span class="badge good">Hyperspec</span>');
  if (p.meltdownIn != null) badges.push(`<span class="badge bad">MELTDOWN ${p.meltdownIn}</span>`);
  badges.push(`<span class="badge ${p.reaction && !(p.braceLock > 0) ? 'good' : ''}">Reaction ${p.reaction && !(p.braceLock > 0) ? 'ready' : 'used'}</span>`);
  badges.push(`<span class="badge">Repairs ${p.repairs}</span>`);
  badges.push(`<span class="badge">HEX ${p.charges}</span>`);
  if (!p.coreUsed) badges.push('<span class="badge good">Core ready</span>');
  if (p.destroyedMounts.length || p.destroyedSystems.length) badges.push(`<span class="badge bad">Lost: ${[...p.destroyedMounts, ...p.destroyedSystems].join(', ')}</span>`);
  document.getElementById('status').innerHTML = `
    <div class="meter"><span class="label">HP ${Math.max(0, p.hp)}/${p.maxHp}</span><div class="bar"><i style="width:${100 * Math.max(0, p.hp) / p.maxHp}%"></i></div></div>
    <div class="meter"><span class="label">Heat ${p.heat}/${p.heatCap}</span><div class="bar heat"><i style="width:${100 * Math.min(p.heat, p.heatCap) / p.heatCap}%"></i></div></div>
    <div class="meter"><span class="label">Struct</span>${pips(p.structure, p.maxStructure)}</div>
    <div class="meter"><span class="label">Stress</span>${pips(p.stress, p.maxStress)}</div>
    <div class="badges">${badges.join('')}</div>`;
}

function btn(id, label, cost, enabled, cls = '') {
  return `<button data-a="${id}" class="${cls}" ${enabled ? '' : 'disabled'}>${label}${cost ? `<span class="cost">${cost}</span>` : ''}</button>`;
}

function renderPanel() {
  const el = document.getElementById('panel');
  const p = player(s);
  const t = s.turn;
  if (ui.busy || s.over || !t) {
    el.innerHTML = `<div class="hint">${s.over ? (s.over === 'win' ? 'Mission complete.' : 'Mission failed.') : 'Resolving…'}</div>`;
    return;
  }
  const econ = `<div class="economy"><span>Actions: ${'● '.repeat(t.base)}${'○ '.repeat(2 - t.base)}${t.bonus ? ` +${t.bonus} free quick` : ''}</span><span>${t.moved ? 'Moved' : 'Move ready'}${t.disengage ? ' · Disengaged' : ''}</span></div>`;
  let html = '';

  if (ui.mode === 'stunned') {
    html = `<div class="hint">Vail is <b>Stunned</b> and can't act this turn.</div>${btn('end', 'End turn', '', true, 'primary')}`;
  } else if (ui.mode === 'inspect') {
    const u = s.units.find((x) => x.id === ui.selected);
    const w = u.weapons[0];
    const range = w.type === 'Melee' ? `Threat ${w.threat}` : `Range ${w.range}${w.blast ? `, Blast ${w.blast}` : ''}`;
    html = `<div class="preview"><b>${esc(u.name)}</b> <span class="muted">${esc(u.role)}${u.tier > 1 ? ` · T${u.tier}` : ''}</span><br>
      HP ${u.hp}/${u.maxHp}${u.maxStructure > 1 ? ` · Structure ${u.structure}` : ''} · Armor ${u.armor} · Evasion ${u.evasion} · Speed ${u.speed}${u.activations > 1 ? ' · 2 activations' : ''}<br>
      ${esc(w.name)}: +${w.bonus} to hit, ${range}, ${w.damage} ${w.dtype.toLowerCase()}${w.loading ? (w.loaded ? ' · loaded' : ' · <b>reloading</b>') : ''}
      ${u.text ? `<br><span class="muted">${esc(u.text)}</span>` : ''}
      ${Object.keys(u.statuses).length ? `<br>Status: ${Object.keys(u.statuses).join(', ')}` : ''}
      <br>Your hit chance: ${hitLine(u)}</div>
      ${btn('cancel', 'Close', '', true)}`;
  } else if (ui.mode === 'move') {
    html = `<div class="hint">Tap a blue hex to ${ui.moveKind === 'boost' ? 'Boost' : 'move'}. Moving next to an enemy stops you.</div>${btn('cancel', 'Cancel', '', true)}`;
  } else if (ui.mode === 'weapons') {
    const opts = ['shotgun', 'pistols', 'blade'].map((id) => {
      const w = PLAYER_WEAPONS[id];
      const okW = weaponAvailable(p, id) && !(ui.barrage && ui.barrage.used.includes(id));
      const n = okW ? weaponTargets(s, id).length : 0;
      return `<button class="weapon-btn" data-w="${id}" ${okW && n ? '' : 'disabled'}>${esc(w.name)}<small>${esc(w.note)}${!weaponAvailable(p, id) ? ' — DESTROYED' : okW && !n ? ' — no targets' : ''}</small></button>`;
    }).join('');
    const title = ui.action === 'barrage' ? `Barrage — weapon ${ui.barrage.used.length + 1} of 2` : 'Skirmish — pick a weapon';
    html = `<div class="hint">${title}</div><div class="grid one">${opts}</div>${
      ui.barrage && ui.barrage.used.length ? btn('barrage-done', 'Finish Barrage', '', true) : btn('cancel', 'Cancel', '', true)}`;
  } else if (ui.mode === 'target') {
    const w = PLAYER_WEAPONS[ui.weapon];
    if (!ui.pending) {
      html = `<div class="hint">${esc(w.name)}: tap a red hex to target.</div>${btn('back-weapons', 'Back', '', true)}`;
    } else {
      const targets = ui.weapon === 'pistols' ? lineTargets(s, ui.pending) : [ui.pending];
      if (!targets.some((x) => x.id === ui.pending.id)) targets.unshift(ui.pending);
      const lines = targets.map((tg) => {
        const pv = attackPreview(s, p, tg, w);
        const mods = [...pv.acc.map(([n, v]) => `+${v} ${n}`), ...pv.diff.map(([n, v]) => `−${v} ${n}`)];
        return `<b>${esc(tg.short)}</b>: ${pct(pv.chance)} to hit (needs ${pv.evasion}${mods.length ? `; ${mods.join(', ')}` : ''})`;
      });
      html = `<div class="preview">${esc(w.name)} · ${esc(w.note)}<br>${lines.join('<br>')}${ui.weapon === 'pistols' ? '<br><span class="muted">Both pistols fire at everything on the line.</span>' : ''}</div>
        <div class="grid two">${btn('fire', 'Fire', '', true, 'primary')}${btn('back-weapons', 'Back', '', true)}</div>`;
    }
  } else if (ui.mode === 'hexmenu') {
    html = `<div class="hint">Pattern-B HEX Charges (${p.charges} left)</div><div class="grid two">
      ${btn('frag', 'Frag Grenade', 'Range 5 · Blast 1 · 1d6', true)}
      ${btn('mine', 'Explosive Mine', 'Adjacent · Burst 1 · 2d6', true)}
      </div>${btn('cancel', 'Cancel', '', true)}`;
  } else if (ui.mode === 'grenade') {
    const inBlast = ui.pendingHex && distance(ui.pendingHex, p.pos) <= 1;
    html = ui.pendingHex
      ? `<div class="preview">Frag Grenade: everyone in the blast rolls an Agility save vs ${p.saveTarget}. On a fail they take 1d6 explosive, or half on a success.${inBlast ? '<br><b>Warning: Vail is in the blast!</b>' : ''}</div>
         <div class="grid two">${btn('throw', 'Throw', '', true, 'primary')}${btn('cancel', 'Cancel', '', true)}</div>`
      : `<div class="hint">Tap a hex within Range 5.</div>${btn('cancel', 'Cancel', '', true)}`;
  } else if (ui.mode === 'mine') {
    html = `<div class="hint">Tap an adjacent hex to place the mine. It blows when an enemy moves next to it.</div>${btn('cancel', 'Cancel', '', true)}`;
  } else if (ui.mode === 'shield') {
    html = `<div class="hint">Projected Shield (1 heat): tap an enemy. Attacks between you and it get +2 Difficulty until your next turn.</div>${btn('cancel', 'Cancel', '', true)}`;
  } else {
    const stunned = has(p, 'stunned');
    const freeBoost = p.coreActive && !t.freeBoostUsed && !t.noFree;
    const quick = (n) => !stunned && canQuick(s, n);
    const full = (n) => !stunned && canFull(s, n);
    const proto = t.protocolsOpen && !stunned;
    const ocHeat = OVERCHARGE_HEAT[Math.min(p.overcharges, 3)];
    html = `${econ}<div class="grid">
      ${btn('move', 'Move', `Speed ${p.speed}`, !t.moved && !stunned)}
      ${btn('boost', 'Boost', freeBoost ? 'Free (Core)' : 'Quick', !stunned && (freeBoost || canQuick(s, 'boost')))}
      ${btn('skirmish', 'Skirmish', 'Quick', quick('skirmish'))}
      ${btn('barrage', 'Barrage', 'Full', full('barrage'))}
      ${btn('hex', 'HEX', `Quick · ${p.charges}`, quick('hex') && p.charges > 0 && !p.destroyedSystems.includes('hex'))}
      ${btn('stabilize', 'Stabilize', 'Full', full('stabilize'))}
      ${btn('disengage', 'Disengage', 'Full', full('disengage') && !t.moved)}
      ${btn('overcharge', 'Overcharge', `+${ocHeat} heat`, !stunned && !t.overcharged && !t.noFree)}
      ${btn('core', 'Core', p.coreUsed ? 'Used' : 'Protocol', proto && !p.coreUsed)}
      ${btn('shield', 'Shield', 'Protocol · 1 heat', proto && !t.shieldUsed && !p.destroyedSystems.includes('shield') && enemies(s).length > 0)}
      ${btn('initiative', 'Initiative', p.initiativeUsed ? 'Used' : 'Free quick', !stunned && !p.initiativeUsed && !t.noFree)}
      ${btn('end', 'End turn', '', true, 'primary')}
    </div>`;
  }
  el.innerHTML = html;
  el.onclick = onPanel;
}

function hitLine(u) {
  const p = player(s);
  const parts = [];
  for (const id of ['shotgun', 'pistols', 'blade']) {
    if (!weaponAvailable(p, id)) continue;
    const w = PLAYER_WEAPONS[id];
    const reach = id === 'blade' ? 1 : (w.range || w.line);
    const d = distance(p.pos, u.pos);
    parts.push(`${w.short} ${d <= reach ? pct(attackPreview(s, p, u, w).chance) : 'out of range'}`);
  }
  return parts.join(' · ');
}

function onPanel(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled || ui.busy) return;
  const p = player(s);
  const t = s.turn;
  if (b.dataset.w) {
    ui.weapon = b.dataset.w;
    ui.pending = null;
    ui.mode = 'target';
    const ts = weaponTargets(s, ui.weapon);
    if (ts.length === 1) ui.pending = ts[0];
    return render();
  }
  const a = b.dataset.a;
  switch (a) {
    case 'cancel':
      ui = { mode: has(p, 'stunned') ? 'stunned' : 'idle', busy: false };
      return render();
    case 'move':
      ui.mode = 'move'; ui.moveKind = 'move';
      ui.reach = reachable(s, p, p.speed, { ignoreEngagement: t.disengage });
      return render();
    case 'boost':
      ui.mode = 'move'; ui.moveKind = 'boost';
      ui.reach = reachable(s, p, p.speed, { ignoreEngagement: t.disengage });
      return render();
    case 'skirmish':
      ui.action = 'skirmish'; ui.barrage = null; ui.mode = 'weapons';
      return render();
    case 'barrage':
      ui.action = 'barrage'; ui.barrage = { used: [] }; ui.mode = 'weapons';
      return render();
    case 'back-weapons':
      ui.mode = 'weapons'; ui.pending = null;
      return render();
    case 'barrage-done':
      ui = { mode: 'idle', busy: false };
      return render();
    case 'fire': {
      const target = ui.pending;
      const id = ui.weapon;
      return run(async () => {
        if (ui.action === 'barrage') {
          if (!ui.barrage.used.length) spendFull(s, 'barrage');
          ui.barrage.used.push(id);
        } else {
          spendQuick(s, 'skirmish');
        }
        await fireWeapon(s, io, id, target);
        ui.pending = null;
        const more = ui.action === 'barrage' && ui.barrage.used.length < 2 &&
          ['shotgun', 'pistols', 'blade'].some((w) => !ui.barrage.used.includes(w) && weaponAvailable(p, w) && weaponTargets(s, w).length);
        ui.mode = more ? 'weapons' : 'idle';
        if (!more) ui.barrage = null;
      });
    }
    case 'hex':
      ui.mode = 'hexmenu';
      return render();
    case 'frag':
      ui.mode = 'grenade'; ui.pendingHex = null;
      return render();
    case 'throw': {
      const h = ui.pendingHex;
      return run(async () => { spendQuick(s, 'hex'); await throwGrenade(s, io, h); ui.mode = 'idle'; });
    }
    case 'mine':
      ui.mode = 'mine';
      return render();
    case 'stabilize':
      return run(async () => {
        const mode = await ask('Stabilize (full action): choose one.', [
          { value: 'cool', label: 'Cool', detail: `Clear all heat (${p.heat}) and Exposed.` },
          ...(p.repairs > 0 ? [{ value: 'repair', label: 'Repair', detail: `Mark 1 Repair (${p.repairs} left): HP back to ${p.maxHp}.` }] : []),
          { value: null, label: 'Cancel' },
        ]);
        if (!mode) return;
        spendFull(s, 'stabilize');
        stabilize(s, io, mode);
      });
    case 'disengage':
      spendFull(s, 'disengage');
      t.disengage = true;
      io.log('Disengage: this turn your movement ignores engagement and Overwatch.', 'info');
      return render();
    case 'overcharge':
      return run(async () => {
        const ok = await ask(`Overcharge: take ${OVERCHARGE_HEAT[Math.min(p.overcharges, 3)]} heat (now ${p.heat}/${p.heatCap}) to gain an extra quick action, even one you've already used.`, [
          { value: true, label: 'Overcharge' }, { value: false, label: 'Cancel' }]);
        if (ok) await overcharge(s, io);
      });
    case 'initiative':
      useInitiative(s, io);
      return render();
    case 'core':
      activateCore(s, io);
      t.protocolsOpen = true; // still at the start of the turn
      return render();
    case 'shield':
      ui.mode = 'shield';
      return render();
    case 'end':
      return endTurn();
    default:
      return undefined;
  }
}

function renderLog() {
  const el = document.getElementById('log');
  if (!el) return;
  const lines = logOpen ? logLines : logLines.slice(-6);
  el.className = `log${logOpen ? ' open' : ''}`;
  el.innerHTML = lines.map((l) => `<p class="${l.kind}">${esc(l.text)}</p>`).join('') +
    (logOpen ? '' : '');
  el.scrollTop = el.scrollHeight;
}
