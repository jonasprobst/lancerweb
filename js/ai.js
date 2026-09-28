// Enemy activations and end-of-round bookkeeping.
import {
  player, enemies, alive, has, reachable, moveAlong, attack, attackMods, hitChance,
  tickStatuses, coverFor, checkObjective, inZone, distance, key, makeNpc, passable, pathDistances,
} from './engine.js';
import { offsetToAxial } from './hex.js';

const wait = (io, ms) => (io.pause ? io.pause(ms) : Promise.resolve());

function reachOf(u, w) {
  return w.type === 'Melee' ? w.threat : w.range;
}

// How good is standing on `h` for this NPC this turn?
function score(s, u, h, walk) {
  const wd = walk.get(key(h)) ?? 99;
  const p = player(s);
  const w = u.weapons[0];
  const d = distance(h, p.pos);
  const old = u.pos;
  u.pos = h;
  let v;
  if (u.ai === 'melee') {
    v = d === 1 ? 100 : -2 * wd;
  } else if (d <= reachOf(u, w)) {
    const m = attackMods(s, u, p, w);
    v = 50 + 40 * hitChance(w.bonus, m.net, m.evasion);
    if (d <= 1) v -= 15; // don't hug the brawler
    if (d <= 3) v -= 5; // shotgun threat
    if (coverFor(s, p.pos, u, { type: 'Ranged' }).value) v += 8;
  } else {
    v = -wd;
  }
  u.pos = old;
  return v;
}

function bestMove(s, u, speed) {
  if (has(u, 'immobilized')) return null;
  const options = reachable(s, u, speed);
  const walk = pathDistances(s, player(s).pos);
  let best = { v: score(s, u, u.pos, walk), path: null };
  for (const [, o] of options) {
    const h = o.path[o.path.length - 1];
    const v = score(s, u, h, walk) - o.dist * 0.01; // prefer shorter moves on ties
    if (v > best.v + 0.001) best = { v, path: o.path };
  }
  return best.path;
}

function canHit(s, u) {
  const w = u.weapons[0];
  if (w.loading && !w.loaded) return false;
  return distance(u.pos, player(s).pos) <= reachOf(u, w);
}

async function activate(s, io, u, opts) {
  s.activeId = u.id;
  const w = u.weapons[0];
  let quick = 2;
  if (has(u, 'stunned')) {
    io.log(`${u.short} is Stunned and can't act.`, 'info');
  } else {
    if (w.loading && !w.loaded) {
      w.loaded = true; quick -= 1;
      io.log(`${u.short} reloads.`, 'info');
    }
    const path = bestMove(s, u, u.speed);
    if (path) {
      await moveAlong(s, io, u, path);
      await wait(io, opts.delay);
    }
    if (alive(u) && !s.over && !canHit(s, u) && quick >= 2 && !has(u, 'stunned')) {
      const boost = bestMove(s, u, u.speed);
      if (boost) {
        quick -= 1;
        io.log(`${u.short} boosts.`, 'info');
        await moveAlong(s, io, u, boost);
        await wait(io, opts.delay);
      }
    }
    if (alive(u) && !s.over && quick > 0 && canHit(s, u) && !has(u, 'stunned')) {
      quick -= 1;
      await attack(s, io, u, player(s), w);
      if (w.loading) w.loaded = false;
      await wait(io, opts.delay);
    }
  }
  tickStatuses(u);
  s.activeId = null;
}

export async function enemyPhase(s, io, opts = { delay: 0 }) {
  for (const u of enemies(s)) u.reaction = true;
  for (const u of [...enemies(s)]) {
    for (let a = 0; a < u.activations; a++) {
      if (s.over || !alive(u)) break;
      await activate(s, io, u, opts);
    }
  }
  if (!s.over) endRound(s, io);
}

function spawnReinforcements(s, io) {
  const o = s.objective;
  const spots = [];
  for (let col = 0; col < s.width; col++) {
    const h = offsetToAxial(col, 0);
    if (passable(s, h)) spots.push(h);
  }
  let n = 0;
  for (const cls of o.reinforcement) {
    if (!spots.length) break;
    const h = spots.splice(Math.floor(s.rng.next() * spots.length), 1)[0];
    s.units.push(makeNpc(cls, h, { tier: o.tier }));
    n += 1;
  }
  o.reinforcementsLeft -= 1;
  if (n) io.log(`⚠ Enemy reinforcements arrive (${n}).`, 'bad');
}

export function endRound(s, io) {
  const o = s.objective;
  if (o.type === 'hold') {
    if (inZone(s, player(s))) {
      o.holdCount += 1;
      io.log(`Zone held: ${o.holdCount}/${o.holdNeeded}.`, 'good');
    } else {
      io.log(`Zone not held (${o.holdCount}/${o.holdNeeded}).`, 'info');
    }
    if (checkObjective(s, io)) return;
    if (o.reinforcementsLeft > 0 && s.round % 2 === 0) spawnReinforcements(s, io);
  }
  s.round += 1;
}

export { key };
