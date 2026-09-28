// A simple scripted pilot, used by tests and the balance simulator.
import {
  player, enemies, alive, has, reachable, distance, key, startPlayerTurn, endPlayerTurn,
  canQuick, canFull, spendQuick, spendFull, fireWeapon, weaponTargets, weaponAvailable,
  moveAlong, activateCore, stabilize, throwGrenade, checkObjective, inZone, pathDistances,
} from './engine.js';
import { enemyPhase } from './ai.js';
import { fromKey } from './hex.js';

function goalFor(s) {
  const p = player(s);
  const o = s.objective;
  if (o.type === 'hold') return [...s.zone].map(fromKey);
  if (o.type === 'assassinate') {
    const t = s.units.find((u) => u.id === o.targetId);
    if (t && alive(t)) return [t.pos];
  }
  const es = enemies(s).sort((a, b) => distance(a.pos, p.pos) - distance(b.pos, p.pos));
  return es.length ? [es[0].pos] : [p.pos];
}

async function moveToward(s, io, disengage = false) {
  const p = player(s);
  const goals = goalFor(s);
  const opts = reachable(s, p, p.speed, { ignoreEngagement: disengage });
  const walks = goals.map((g) => pathDistances(s, g));
  const d = (h) => Math.min(...walks.map((w) => w.get(key(h)) ?? 99));
  let best = null, bestD = d(p.pos);
  if (s.objective.type === 'hold' && inZone(s, p)) return;
  for (const [, o] of opts) {
    const h = o.path[o.path.length - 1];
    if (d(h) < bestD) { bestD = d(h); best = o.path; }
  }
  if (best) await moveAlong(s, io, p, best, { disengage });
}

async function shoot(s, io, id) {
  const ts = weaponTargets(s, id);
  if (!ts.length) return false;
  ts.sort((a, b) => a.hp - b.hp);
  await fireWeapon(s, io, id, ts[0]);
  if (id === 'pistols' && !s.over) {
    const next = weaponTargets(s, id).sort((a, b) => a.hp - b.hp)[0];
    if (next) await fireWeapon(s, io, id, next, { aux: true });
  }
  return true;
}

export async function autoPlayerTurn(s, io) {
  startPlayerTurn(s, io);
  const p = player(s);
  const t = s.turn;
  if (has(p, 'stunned')) { io.log('Vail is Stunned.', 'bad'); endPlayerTurn(s, io); return; }
  if (!p.coreUsed && s.round >= 2 && !t.braced) activateCore(s, io);
  if (canFull(s, 'stabilize') && (p.heat >= 5 || has(p, 'exposed'))) {
    spendFull(s, 'stabilize'); stabilize(s, io, 'cool');
  } else if (canFull(s, 'stabilize') && p.hp <= 5 && p.repairs > 0 && p.structure <= 2) {
    spendFull(s, 'stabilize'); stabilize(s, io, 'repair');
  }
  if (!t.moved) { t.moved = true; t.protocolsOpen = false; await moveToward(s, io); }
  const ok = (id) => weaponAvailable(p, id);
  if (!s.over && canFull(s, 'barrage')) {
    const melee = ok('blade') && weaponTargets(s, 'blade').length;
    const ranged = ['shotgun', 'pistols'].filter((id) => ok(id) && weaponTargets(s, id).length);
    const picks = [...(melee ? ['blade'] : []), ...ranged].slice(0, 2);
    if (picks.length === 2) {
      spendFull(s, 'barrage');
      for (const id of picks) if (!s.over) await shoot(s, io, id);
    }
  }
  if (!s.over && canQuick(s, 'skirmish')) {
    const id = ['blade', 'shotgun', 'pistols'].find((w) => ok(w) && weaponTargets(s, w).length);
    if (id) { spendQuick(s, 'skirmish'); await shoot(s, io, id); }
  }
  if (!s.over && p.charges > 0 && canQuick(s, 'hex')) {
    const cluster = enemies(s).find((e) => distance(e.pos, p.pos) <= 5 && distance(e.pos, p.pos) >= 2 &&
      enemies(s).filter((o) => distance(o.pos, e.pos) <= 1).length >= 2);
    if (cluster) { spendQuick(s, 'hex'); await throwGrenade(s, io, cluster.pos); }
  }
  if (!s.over && canQuick(s, 'boost') && !has(p, 'stunned')) {
    spendQuick(s, 'boost'); await moveToward(s, io);
    if (!s.over && canQuick(s, 'skirmish')) {
      const id = ['blade', 'shotgun', 'pistols'].find((w) => ok(w) && weaponTargets(s, w).length);
      if (id) { spendQuick(s, 'skirmish'); await shoot(s, io, id); }
    }
  }
  endPlayerTurn(s, io);
  checkObjective(s, io);
}

export const autoIo = (verbose = false) => ({
  log: (t) => { if (verbose) console.log(t); },
  ask: async (_q, options) => (options.find((o) => o.value === 'brace') ? 'brace' : options[0].value),
  pause: async () => {},
});

export async function autoBattle(s, io, maxRounds = 30) {
  while (!s.over && s.round <= maxRounds) {
    await autoPlayerTurn(s, io);
    if (s.over) break;
    await enemyPhase(s, io);
  }
  return s.over || 'timeout';
}

export { key };
