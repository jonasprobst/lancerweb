// Lancer combat rules engine (core rules, trimmed). No DOM here.
// Anything that needs a player decision goes through `io.ask`, and every
// visible event goes through `io.log`, so the same engine runs in the
// browser and in node tests.
import { key, fromKey, neighbors, distance, same, line, ray, axialToOffset } from './hex.js';
import { MECH, PILOT, PLAYER_WEAPONS, NPC_CLASSES, QUIPS } from './data.js';

export const OVERCHARGE_HEAT = [1, '1d3', '1d6', '1d6+4'];
const DOUBLED_BY_EXPOSED = ['Kinetic', 'Explosive', 'Energy'];

// ---------------------------------------------------------------- units

export function makePlayer(pos) {
  return {
    id: 'vail', side: 'player', name: MECH.name, short: 'Vail', letter: 'V', pos,
    hp: MECH.maxHp, maxHp: MECH.maxHp,
    structure: MECH.structure, maxStructure: MECH.structure,
    stress: MECH.stress, maxStress: MECH.stress,
    heat: 0, heatCap: MECH.heatCap,
    armor: MECH.armor, evasion: MECH.evasion, speed: MECH.speed,
    saveTarget: MECH.saveTarget, hase: { ...PILOT.hase },
    repairs: MECH.repairs, charges: 3, overcharges: 0,
    paintUsed: false, coreUsed: false, coreActive: false, initiativeUsed: false,
    destroyedMounts: [], destroyedSystems: [],
    statuses: {}, reaction: true, meltdownIn: null, braceLock: 0,
    destroyed: false,
  };
}

let npcSeq = 0;
export function makeNpc(classId, pos, { tier = 1, veteran = false, elite = false, commander = false } = {}) {
  const c = NPC_CLASSES[classId];
  const t = tier - 1;
  let hp = c.hp === 1 ? 1 : Math.round(c.hp * (1 + 0.3 * t));
  let bonusAdd = t;
  let prefix = '';
  if (veteran && c.hp > 1) { hp += 4; bonusAdd += 1; prefix = 'Veteran '; }
  if (elite) { hp += 2; prefix = 'Elite '; }
  if (commander) prefix = 'Commander ';
  npcSeq += 1;
  return {
    id: `npc${npcSeq}`, side: 'enemy', classId, name: prefix + c.name, short: c.name,
    letter: c.letter, role: c.role, ai: c.ai, text: c.text, pos, tier,
    hp, maxHp: hp,
    structure: elite ? 2 : 1, maxStructure: elite ? 2 : 1,
    armor: c.armor, evasion: c.evasion, edef: c.edef, speed: c.speed,
    agi: c.agi, hull: c.hull,
    weapons: c.weapons.map((w) => ({ ...w, bonus: w.bonus + bonusAdd, damage: w.damage + t, loaded: true })),
    activations: elite ? 2 : 1,
    elite, veteran, commander,
    statuses: {}, reaction: true, destroyed: false, heat: 0,
  };
}

// ---------------------------------------------------------------- state

export function makeState({ rng, width = 8, height = 10, terrain = [], zone = [], units = [], objective = { type: 'eliminate' } }) {
  return {
    rng, width, height,
    terrain: new Set(terrain.map(key)),
    zone: new Set(zone.map(key)),
    mines: [],
    units,
    round: 1,
    activeId: null,
    objective: { holdCount: 0, ...objective },
    shieldLink: null,
    turn: null,
    backswingRound: 0,
    over: null,
    settings: { autoOverwatch: true },
    kills: 0,
  };
}

export const player = (s) => s.units.find((u) => u.side === 'player');
export const alive = (u) => !u.destroyed;
export const enemies = (s) => s.units.filter((u) => u.side === 'enemy' && alive(u));
export const hostilesOf = (s, u) => s.units.filter((o) => alive(o) && o.side !== u.side);
export const unitAt = (s, h) => s.units.find((u) => alive(u) && same(u.pos, h));

export function inBounds(s, h) {
  const { col, row } = axialToOffset(h);
  return col >= 0 && col < s.width && row >= 0 && row < s.height;
}

export const isCover = (s, h) => s.terrain.has(key(h));
export const passable = (s, h) => inBounds(s, h) && !isCover(s, h) && !unitAt(s, h);

export function isEngaged(s, u) {
  return hostilesOf(s, u).some((o) => distance(o.pos, u.pos) === 1);
}

export const has = (u, status) => (u.statuses[status] || 0) > 0;

// Status lasting "until the end of <u>'s next turn".
export function addStatus(s, u, status, persistent = false) {
  if (persistent) { u.statuses[status] = Infinity; return; }
  const ticks = s.activeId === u.id ? 2 : 1;
  u.statuses[status] = Math.max(u.statuses[status] || 0, ticks);
}

export function tickStatuses(u) {
  for (const k of Object.keys(u.statuses)) {
    if (u.statuses[k] === Infinity) continue;
    u.statuses[k] -= 1;
    if (u.statuses[k] <= 0) delete u.statuses[k];
  }
}

// ---------------------------------------------------------------- movement

// Hexes reachable with `speed` spaces of movement. Entering a hex that makes
// you newly Engaged stops you there (all mechs here are Size 1).
export function reachable(s, u, speed, { ignoreEngagement = false } = {}) {
  const hostiles = hostilesOf(s, u);
  const adjHostiles = (h) => hostiles.filter((o) => distance(o.pos, h) === 1).map((o) => o.id);
  const start = key(u.pos);
  const out = new Map([[start, { dist: 0, path: [u.pos] }]]);
  const frontier = [{ h: u.pos, dist: 0, path: [u.pos] }];
  while (frontier.length) {
    const cur = frontier.shift();
    if (cur.dist >= speed) continue;
    const curAdj = adjHostiles(cur.h);
    for (const n of neighbors(cur.h)) {
      const k = key(n);
      if (out.has(k) || !passable(s, n)) continue;
      const path = [...cur.path, n];
      out.set(k, { dist: cur.dist + 1, path });
      const newlyEngaged = adjHostiles(n).some((id) => !curAdj.includes(id));
      if (newlyEngaged && !ignoreEngagement) continue;
      frontier.push({ h: n, dist: cur.dist + 1, path });
    }
  }
  out.delete(start);
  return out;
}

// Walking distance from `from` to every hex, around walls (units ignored).
export function pathDistances(s, from) {
  const out = new Map([[key(from), 0]]);
  const q = [from];
  while (q.length) {
    const h = q.shift();
    const d = out.get(key(h));
    for (const n of neighbors(h)) {
      const k = key(n);
      if (out.has(k) || !inBounds(s, n) || isCover(s, n)) continue;
      out.set(k, d + 1);
      q.push(n);
    }
  }
  return out;
}

// ---------------------------------------------------------------- dice

export function rollAttack(rng, bonus, net) {
  const d20 = rng.die(20);
  const dice = [];
  for (let i = 0; i < Math.abs(net); i++) dice.push(rng.die(6));
  const extra = dice.length ? Math.max(...dice) * Math.sign(net) : 0;
  return { d20, dice, extra, total: d20 + bonus + extra };
}

// Exact probability that d20 + bonus ± highest of |net| d6 >= target.
export function hitChance(bonus, net, target) {
  const n = Math.abs(net);
  // distribution of highest d6 of n dice
  const hi = [];
  if (n === 0) hi.push([0, 1]);
  else for (let v = 1; v <= 6; v++) hi.push([v * Math.sign(net), Math.pow(v / 6, n) - Math.pow((v - 1) / 6, n)]);
  let p = 0;
  for (let d = 1; d <= 20; d++) for (const [x, px] of hi) if (d + bonus + x >= target) p += px / 20;
  return p;
}

function fmtRoll(r, bonus) {
  let t = `d20 ${r.d20}`;
  if (bonus) t += ` ${bonus > 0 ? '+' : '−'}${Math.abs(bonus)}`;
  if (r.dice.length) t += ` ${r.extra >= 0 ? '+' : '−'}${Math.abs(r.extra)} [${r.dice.join(',')}]`;
  return `${t} = ${r.total}`;
}

// Mech skill check / save. Returns success boolean.
export async function check(s, io, u, skill, target, label) {
  let acc = 0, diff = 0;
  if (u.side === 'player' && u.coreActive) acc += 1;
  if (has(u, 'impaired')) diff += 1;
  if (has(u, 'stunned') && (skill === 'hull' || skill === 'agi')) {
    io.log(`${u.short} is Stunned and automatically fails the ${label}.`, 'bad');
    return false;
  }
  const bonus = u.side === 'player' ? u.hase[skill] : (u[skill] || 0);
  const r = rollAttack(s.rng, bonus, acc - diff);
  const ok = r.total >= target;
  io.log(`${u.short} ${label}: ${fmtRoll(r, bonus)} vs ${target} → ${ok ? 'success' : 'fail'}`, ok ? 'info' : 'bad');
  return ok;
}

// ---------------------------------------------------------------- attacks

// Cover the target has against a ranged attack from `from`.
export function coverFor(s, from, target, weapon) {
  if (weapon.type === 'Melee' || weapon.arcing) return { value: 0, label: '' };
  let value = 0, label = '';
  const ln = line(from, target.pos).slice(1, -1);
  if (ln.some((h) => isCover(s, h) && distance(h, target.pos) === 1)) { value = 2; label = 'hard cover'; }
  if (value < 1 && target.side === 'player' && isEngaged(s, target)) { value = 1; label = 'soft cover (Shield of Blades)'; }
  return { value, label };
}

export function attackMods(s, attacker, target, weapon) {
  const acc = [], diff = [];
  const d = distance(attacker.pos, target.pos);
  if (weapon.accuracy) acc.push(['weapon', weapon.accuracy]);
  if (attacker.side === 'player') {
    if (weapon.type === 'CQB' && d <= 3) acc.push(['Handshake Etiquette', 1]);
    if (attacker.coreActive) acc.push(['Hyperspec', 1]);
  }
  if (target.side === 'player' && has(target, 'lockon')) acc.push(['Lock On', 1]);
  if (has(attacker, 'impaired')) diff.push(['Impaired', 1]);
  if (weapon.type !== 'Melee' && isEngaged(s, attacker)) diff.push(['Engaged', 1]);
  const cover = coverFor(s, attacker.pos, target, weapon);
  if (cover.value) diff.push([cover.label, cover.value]);
  const link = s.shieldLink;
  if (link && ((attacker.side === 'player' && target.id === link) || (target.side === 'player' && attacker.id === link))) {
    diff.push(['Projected Shield', 2]);
  }
  if (has(target, 'braced')) diff.push(['Braced', 1]);
  const net = acc.reduce((a, [, v]) => a + v, 0) - diff.reduce((a, [, v]) => a + v, 0);
  const evasion = has(target, 'stunned') ? Math.min(5, target.evasion) : target.evasion;
  return { acc, diff, net, evasion };
}

export function attackPreview(s, attacker, target, weapon) {
  const m = attackMods(s, attacker, target, weapon);
  const bonus = attacker.side === 'player' ? PILOT.grit : weapon.bonus;
  return { ...m, bonus, chance: hitChance(bonus, m.net, m.evasion) };
}

// One attack roll + damage. Returns { hit, crit }.
export async function attack(s, io, attacker, target, weapon, { half = false, label } = {}) {
  if (!alive(target) || !alive(attacker)) return { hit: false };
  const m = attackMods(s, attacker, target, weapon);
  const bonus = attacker.side === 'player' ? PILOT.grit : weapon.bonus;
  const r = rollAttack(s.rng, bonus, m.net);
  if (target.side === 'player' && has(target, 'lockon')) delete target.statuses.lockon;
  const hit = r.total >= m.evasion;
  const crit = hit && attacker.side === 'player' && r.total >= 20;
  const mods = [...m.acc.map(([n, v]) => `+${v} ${n}`), ...m.diff.map(([n, v]) => `−${v} ${n}`)];
  io.log(
    `${attacker.short} → ${target.short} (${label || weapon.name}): ${fmtRoll(r, bonus)} vs Evasion ${m.evasion}` +
      `${mods.length ? ` (${mods.join(', ')})` : ''} → ${crit ? 'CRIT!' : hit ? 'HIT' : 'miss'}`,
    hit ? (attacker.side === 'player' ? 'good' : 'bad') : 'info',
  );
  if (!hit) return { hit };
  let dmg = s.rng.roll(weapon.damage);
  if (crit && typeof weapon.damage === 'string') {
    const again = s.rng.roll(weapon.damage);
    if (again.total > dmg.total) dmg = again;
  }
  let amount = dmg.total;
  if (half) amount = Math.ceil(amount / 2);
  await dealDamage(s, io, target, amount, weapon.dtype, { ap: weapon.ap, attacker, rolls: dmg.rolls });
  if (weapon.lockOn && alive(target)) {
    addStatus(s, target, 'lockon', true);
    io.log(`${target.short} is Locked On.`, 'bad');
  }
  return { hit, crit };
}

// ---------------------------------------------------------------- damage

export async function dealDamage(s, io, target, amount, dtype, { ap = false, attacker = null, rolls = [], resist = false } = {}) {
  if (!alive(target)) return;
  let d = amount;
  const notes = [];
  if (rolls.length) notes.push(`rolled ${rolls.join('+')}`);
  if (has(target, 'exposed') && DOUBLED_BY_EXPOSED.includes(dtype)) { d *= 2; notes.push('×2 Exposed'); }
  if (!ap && target.armor) { d = Math.max(0, d - target.armor); notes.push(`−${target.armor} armor`); }
  if (ap && target.armor) notes.push('AP');

  // Brace: reaction when a hit would take structure.
  if (
    target.side === 'player' && attacker && !resist && d >= target.hp && d > 0 &&
    canReact(target)
  ) {
    const choice = await io.ask(
      `Incoming: ${d} ${dtype.toLowerCase()} damage from ${attacker.short}. That will cost you structure.`,
      [
        { value: 'brace', label: 'Brace (halve it)', detail: 'Uses your reaction. Next turn: only one quick action, no move.' },
        { value: 'take', label: 'Take it' },
      ],
    );
    if (choice === 'brace') {
      resist = true;
      target.reaction = false;
      target.braceLock = s.activeId === target.id ? 2 : 1;
      addStatus(s, target, 'braced');
      io.log('Vail braces for impact!', 'info');
    }
  }
  if (resist) { d = Math.ceil(d / 2); notes.push('halved (Brace)'); }

  io.log(`  ${target.short} takes ${d} ${dtype.toLowerCase()} damage${notes.length ? ` (${notes.join(', ')})` : ''}.`, target.side === 'player' ? 'bad' : 'good');
  if (d <= 0) return;
  target.hp -= d;
  if (target.hp > 0) return;
  if (target.side === 'player') await playerStructure(s, io, target);
  else npcStructure(s, io, target);
}

function npcStructure(s, io, u) {
  u.structure -= 1;
  if (u.structure <= 0) {
    u.hp = 0;
    u.destroyed = true;
    s.kills += 1;
    io.log(`✖ ${u.name} destroyed.`, 'good');
    if (s.rng.next() < 0.35) io.log(`Vail: “${s.rng.pick(QUIPS.kill)}”`, 'quip');
    checkObjective(s, io);
    return;
  }
  u.hp = u.maxHp;
  addStatus(s, u, 'impaired');
  io.log(`${u.name} loses a structure and is Impaired.`, 'good');
}

function destroyPlayer(s, io, u, why) {
  u.destroyed = true;
  u.hp = 0;
  io.log(`✖ ${why}`, 'bad');
  io.log(`Vail: “${s.rng.pick(QUIPS.lose)}”`, 'quip');
  s.over = 'lose';
}

async function playerStructure(s, io, u) {
  if (!u.paintUsed) {
    u.paintUsed = true;
    const r = s.rng.die(6);
    io.log(`Custom Paint Job: rolled ${r}${r === 6 ? ' — just scratched the paint! Back to 1 HP.' : '.'}`, r === 6 ? 'good' : 'info');
    if (r === 6) { u.hp = 1; return; }
  }
  u.structure -= 1;
  u.hp = u.maxHp;
  io.log(`⚠ Structure damage! ${u.structure} structure left.`, 'bad');
  if (u.structure <= 0) return destroyPlayer(s, io, u, 'Moral Responsibility is destroyed.');
  const n = u.maxStructure - u.structure;
  const dice = Array.from({ length: n }, () => s.rng.die(6));
  const low = Math.min(...dice);
  const ones = dice.filter((d) => d === 1).length;
  io.log(`Structure check: [${dice.join(',')}] → ${low}`, 'bad');
  if (ones >= 2) return destroyPlayer(s, io, u, 'CRUSHING HIT — the mech is torn apart.');
  if (low >= 5) {
    addStatus(s, u, 'impaired');
    io.log('Glancing Blow: Impaired until the end of your next turn.', 'bad');
  } else if (low >= 2) {
    await systemTrauma(s, io, u);
  } else {
    await directHit(s, io, u);
  }
  if (!u.destroyed && s.rng.next() < 0.5) io.log(`Vail: “${s.rng.pick(QUIPS.structure)}”`, 'quip');
}

function validTrauma(u) {
  const mounts = MECH.mounts.filter((m) => !u.destroyedMounts.includes(m.id));
  const systems = [];
  if (!u.destroyedSystems.includes('shield')) systems.push({ id: 'shield', label: 'Type-3 Projected Shield' });
  if (!u.destroyedSystems.includes('hex') && u.charges > 0) systems.push({ id: 'hex', label: 'Pattern-B HEX Charges' });
  if (!u.destroyedSystems.includes('personal')) systems.push({ id: 'personal', label: 'Personalizations (−2 max HP)' });
  return { mounts, systems };
}

async function systemTrauma(s, io, u) {
  const r = s.rng.die(6);
  const { mounts, systems } = validTrauma(u);
  let kind = r <= 3 ? 'mount' : 'system';
  if (kind === 'mount' && !mounts.length) kind = 'system';
  if (kind === 'system' && !systems.length) kind = mounts.length ? 'mount' : null;
  if (!kind) return directHit(s, io, u);
  const opts = kind === 'mount'
    ? mounts.map((m) => ({ value: m.id, label: `${m.label}: ${m.weapons.map((w) => PLAYER_WEAPONS[w].name).join(', ')}` }))
    : systems.map((x) => ({ value: x.id, label: x.label }));
  const pick = await io.ask(`System Trauma (rolled ${r}): choose ${kind === 'mount' ? 'a mount' : 'a system'} to lose.`, opts);
  if (kind === 'mount') {
    u.destroyedMounts.push(pick);
    io.log(`System Trauma: ${opts.find((o) => o.value === pick).label} destroyed.`, 'bad');
  } else {
    u.destroyedSystems.push(pick);
    if (pick === 'personal') { u.maxHp -= 2; u.hp = Math.min(u.hp, u.maxHp); }
    if (pick === 'shield' && s.shieldLink) s.shieldLink = null;
    io.log(`System Trauma: ${opts.find((o) => o.value === pick).label} destroyed.`, 'bad');
  }
}

async function directHit(s, io, u) {
  if (u.structure >= 3) {
    addStatus(s, u, 'stunned');
    io.log('Direct Hit: Stunned until the end of your next turn.', 'bad');
  } else if (u.structure === 2) {
    const ok = await check(s, io, u, 'hull', 10, 'Hull check (Direct Hit)');
    if (ok) { addStatus(s, u, 'stunned'); io.log('Direct Hit: Stunned until the end of your next turn.', 'bad'); }
    else destroyPlayer(s, io, u, 'Direct Hit — Moral Responsibility is destroyed.');
  } else {
    destroyPlayer(s, io, u, 'Direct Hit — Moral Responsibility is destroyed.');
  }
}

// ---------------------------------------------------------------- heat

export async function addHeat(s, io, u, n, why) {
  if (u.side !== 'player' || n <= 0) return;
  u.heat += n;
  io.log(`${why}: +${n} heat (${Math.min(u.heat, u.heatCap)}/${u.heatCap}).`, 'info');
  while (u.heat > u.heatCap && !u.destroyed) {
    u.heat -= u.heatCap;
    u.stress -= 1;
    io.log(`⚠ Overheating! Stress ${u.stress}/${u.maxStress}.`, 'bad');
    if (u.stress <= 0) { destroyPlayer(s, io, u, 'Reactor meltdown.'); return; }
    const n2 = u.maxStress - u.stress;
    const dice = Array.from({ length: n2 }, () => s.rng.die(6));
    const low = Math.min(...dice);
    io.log(`Overheating check: [${dice.join(',')}] → ${low}`, 'bad');
    if (dice.filter((d) => d === 1).length >= 2) {
      u.meltdownIn = s.activeId === u.id ? 2 : 1;
      io.log('IRREVERSIBLE MELTDOWN: the reactor goes critical at the end of your next turn.', 'bad');
    } else if (low >= 5) {
      addStatus(s, u, 'impaired');
      io.log('Emergency Shunt: Impaired until the end of your next turn.', 'bad');
    } else if (low >= 2 || u.stress >= 3) {
      addStatus(s, u, 'exposed', true);
      io.log('Destabilized Power Plant: Exposed (double damage) until you Stabilize.', 'bad');
    } else if (u.stress === 2) {
      const ok = await check(s, io, u, 'eng', 10, 'Engineering check (Meltdown)');
      if (ok) { addStatus(s, u, 'exposed', true); io.log('Exposed until you Stabilize.', 'bad'); }
      else {
        u.meltdownIn = s.rng.die(6);
        io.log(`Reactor meltdown in ${u.meltdownIn} turn(s)!`, 'bad');
      }
    } else {
      u.meltdownIn = s.activeId === u.id ? 2 : 1;
      io.log('Meltdown: the reactor blows at the end of your next turn.', 'bad');
    }
  }
}

// ---------------------------------------------------------------- reactions

export const canReact = (u) => alive(u) && u.reaction && !has(u, 'stunned') && !(u.braceLock > 0);

function threatWeapons(u) {
  if (u.side === 'player') {
    const ws = [];
    if (!u.destroyedMounts.includes('heavy')) ws.push(PLAYER_WEAPONS.blade);
    if (!u.destroyedMounts.includes('main')) ws.push(PLAYER_WEAPONS.shotgun);
    return ws;
  }
  return u.weapons.filter((w) => w.threat);
}

// Overwatch: `mover` is about to move. Hostiles with it in Threat may skirmish.
async function overwatch(s, io, mover) {
  for (const o of hostilesOf(s, mover)) {
    if (!alive(mover) || s.over) return;
    if (!canReact(o)) continue;
    if (o.side === 'player' && !s.settings.autoOverwatch) continue;
    const d = distance(o.pos, mover.pos);
    const w = threatWeapons(o).find((x) => d <= x.threat);
    if (!w) continue;
    o.reaction = false;
    io.log(`${o.short} OVERWATCH!`, o.side === 'player' ? 'good' : 'bad');
    await attack(s, io, o, mover, w);
  }
}

// ---------------------------------------------------------------- moving

// Move along a path. Handles overwatch at the start and mines along the way.
export async function moveAlong(s, io, u, path, { disengage = false } = {}) {
  if (!disengage) await overwatch(s, io, u);
  if (!alive(u) || s.over || has(u, 'stunned')) return;
  const steps = path.slice(1);
  for (const h of steps) {
    u.pos = h;
    const mine = u.side === 'enemy' && s.mines.find((m) => distance(m.pos, h) <= 1);
    if (mine) {
      await detonateMine(s, io, mine);
      break;
    }
  }
}

async function detonateMine(s, io, mine) {
  s.mines = s.mines.filter((m) => m !== mine);
  io.log('💥 Explosive Mine triggered!', 'good');
  const hit = s.units.filter((o) => alive(o) && distance(o.pos, mine.pos) <= 1);
  const dmg = s.rng.roll('2d6');
  for (const o of hit) await explosiveSave(s, io, o, dmg.total, 'Mine');
}

async function explosiveSave(s, io, o, total, label) {
  const ok = await check(s, io, o, 'agi', player(s).saveTarget, `Agility save (${label})`);
  await dealDamage(s, io, o, ok ? Math.ceil(total / 2) : total, 'Explosive', {});
}

// ---------------------------------------------------------------- player turn

export function startPlayerTurn(s, io) {
  const u = player(s);
  s.activeId = u.id;
  s.shieldLink = null;
  const braced = u.braceLock > 0;
  u.reaction = !braced;
  s.turn = {
    moved: braced,
    base: braced ? 1 : 2,
    bonus: 0,
    used: [],
    protocolsOpen: true,
    freeBoostUsed: false,
    overcharged: braced,
    noFree: braced,
    disengage: false,
    braced,
  };
  if (braced) io.log('Braced last round: only one quick action this turn.', 'info');
}

export function endPlayerTurn(s, io) {
  const u = player(s);
  tickStatuses(u);
  if (u.braceLock > 0) u.braceLock -= 1;
  if (u.meltdownIn != null) {
    u.meltdownIn -= 1;
    if (u.meltdownIn <= 0) destroyPlayer(s, io, u, 'The reactor melts down. Moral Responsibility is gone.');
    else io.log(`Reactor meltdown in ${u.meltdownIn} turn(s)…`, 'bad');
  }
  s.activeId = null;
}

// Can the player take this quick action now?
export function canQuick(s, name) {
  const t = s.turn;
  if (!t) return false;
  if (t.bonus > 0) return true;
  return t.base >= 1 && !t.used.includes(name);
}
export function canFull(s, name) {
  const t = s.turn;
  return !!t && t.base === 2 && !t.used.includes(name);
}
export function spendQuick(s, name) {
  const t = s.turn;
  t.protocolsOpen = false;
  if (t.base >= 1 && !t.used.includes(name)) t.base -= 1;
  else t.bonus -= 1;
  t.used.push(name);
}
export function spendFull(s, name) {
  const t = s.turn;
  t.protocolsOpen = false;
  t.base = 0;
  t.used.push(name);
}

export function weaponAvailable(u, id) {
  return !u.destroyedMounts.includes(PLAYER_WEAPONS[id].mount);
}

export function weaponTargets(s, id) {
  const u = player(s);
  const w = PLAYER_WEAPONS[id];
  const reach = w.threat === 1 && w.type === 'Melee' ? 1 : (w.range || w.line);
  return enemies(s).filter((e) => distance(u.pos, e.pos) <= reach);
}

// Everything the pistols' Line 5 would hit when aimed at `target`.
export function lineTargets(s, target) {
  const u = player(s);
  const hexes = ray(u.pos, target.pos, 5).map(key);
  return enemies(s).filter((e) => hexes.includes(key(e.pos)));
}

// Fire a weapon group at a target (player).
export async function fireWeapon(s, io, id, target) {
  const u = player(s);
  const w = PLAYER_WEAPONS[id];
  if (id === 'pistols') {
    const targets = lineTargets(s, target);
    if (!targets.some((t) => t.id === target.id)) targets.unshift(target);
    for (const [i, label] of ['Thermal Pistol', 'Thermal Pistol (Aux)'].entries()) {
      if (i > 0 && !targets.some(alive)) break;
      for (const t of targets) if (alive(t)) await attack(s, io, u, t, w, { label });
    }
    return;
  }
  const res = await attack(s, io, u, target, w);
  // Executioner I: Backswing Cut
  if (id === 'blade' && res.hit && s.backswingRound !== s.round && alive(u) && !s.over) {
    const other = enemies(s)
      .filter((e) => e.id !== target.id && distance(e.pos, u.pos) <= 1)
      .sort((a, b) => a.hp - b.hp)[0];
    if (other) {
      s.backswingRound = s.round;
      io.log('Backswing Cut!', 'good');
      await attack(s, io, u, other, w, { half: true, label: 'Backswing Cut, half damage' });
    }
  }
}

export async function throwGrenade(s, io, hex) {
  const u = player(s);
  u.charges -= 1;
  io.log(`Vail throws a Frag Grenade. (${u.charges} HEX charge${u.charges === 1 ? '' : 's'} left)`, 'info');
  const dmg = s.rng.roll('1d6');
  const hit = s.units.filter((o) => alive(o) && distance(o.pos, hex) <= 1);
  if (!hit.length) io.log('  …nobody in the blast.', 'info');
  for (const o of hit) await explosiveSave(s, io, o, dmg.total, 'Frag Grenade');
}

export function placeMine(s, io, hex) {
  const u = player(s);
  u.charges -= 1;
  s.mines.push({ pos: hex });
  io.log(`Vail places an Explosive Mine. (${u.charges} HEX charge${u.charges === 1 ? '' : 's'} left)`, 'info');
}

export async function overcharge(s, io) {
  const u = player(s);
  const t = s.turn;
  t.overcharged = true;
  t.bonus += 1;
  t.protocolsOpen = false;
  const expr = OVERCHARGE_HEAT[Math.min(u.overcharges, 3)];
  u.overcharges += 1;
  const r = s.rng.roll(expr);
  await addHeat(s, io, u, r.total, `Overcharge (${expr})`);
}

export function useInitiative(s, io) {
  const u = player(s);
  u.initiativeUsed = true;
  s.turn.bonus += 1;
  s.turn.protocolsOpen = false;
  io.log('Everest Initiative: next quick action is free.', 'info');
}

export function activateCore(s, io) {
  const u = player(s);
  u.coreUsed = true;
  u.coreActive = true;
  io.log('⚡ HYPERSPEC FUEL INJECTOR: +1 Accuracy on everything, free Boost each turn.', 'good');
}

export async function projectShield(s, io, target) {
  const u = player(s);
  s.shieldLink = target.id;
  io.log(`Projected Shield on ${target.short}: attacks between you get +2 Difficulty.`, 'info');
  await addHeat(s, io, u, 1, 'Projected Shield');
}

export function stabilize(s, io, mode) {
  const u = player(s);
  if (mode === 'repair') {
    u.repairs -= 1;
    u.hp = u.maxHp;
    io.log(`Stabilize: marked a Repair, HP restored to ${u.maxHp}. (${u.repairs} left)`, 'good');
  } else {
    u.heat = 0;
    delete u.statuses.exposed;
    io.log('Stabilize: heat vented, Exposed cleared.', 'good');
  }
  for (const c of ['impaired', 'lockon']) {
    if (has(u, c)) { delete u.statuses[c]; io.log(`Stabilize: cleared ${c === 'lockon' ? 'Lock On' : 'Impaired'}.`, 'good'); break; }
  }
}

// ---------------------------------------------------------------- objective

export function checkObjective(s, io) {
  if (s.over) return s.over;
  const p = player(s);
  if (!alive(p)) { s.over = 'lose'; return s.over; }
  const o = s.objective;
  if (o.type === 'eliminate' && enemies(s).length === 0) s.over = 'win';
  if (o.type === 'assassinate') {
    const t = s.units.find((u) => u.id === o.targetId);
    if (!t || !alive(t)) s.over = 'win';
  }
  if (o.type === 'hold' && (o.holdCount >= o.holdNeeded || enemies(s).length === 0 && o.reinforcementsLeft <= 0)) s.over = 'win';
  if (s.over === 'win') io.log(`Vail: “${s.rng.pick(QUIPS.win)}”`, 'quip');
  return s.over;
}

export function inZone(s, u) {
  return s.zone.has(key(u.pos));
}

export { key, fromKey, distance, neighbors };
