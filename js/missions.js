// Mission generator: every win makes the next one harder.
import { offsetToAxial, key, neighbors } from './hex.js';
import { makeState, makePlayer, makeNpc } from './engine.js';
import { NPC_CLASSES } from './data.js';

const W = 8, H = 10;

const NAMES = ['Tin Door', 'Cold Ledger', 'Quiet Relay', 'Glass Harbor', 'Iron Psalm', 'Ashfall', 'Low Orbit',
  'Paper Wall', 'Salt Line', 'Blind Switch', 'Red Key', 'Dead Channel', 'Hollow Gate', 'Long Night', 'Dust Choir'];

export function tierFor(n) {
  return n >= 16 ? 3 : n >= 9 ? 2 : 1;
}

// Enemy budget in "NPC points" (one standard NPC = 1, a Grunt = 0.5).
export function budgetFor(n) {
  const raw = 1.5 + 0.6 * (n - 1);
  const t = tierFor(n);
  // Stepping up a tier makes each NPC much tougher, so ease the count back.
  return t === 3 ? raw * 0.55 : t === 2 ? raw * 0.7 : raw;
}

export function poolFor(n) {
  const pool = ['assault'];
  if (n >= 2) pool.push('berserker');
  if (n >= 3) pool.push('scout');
  if (n >= 4) pool.push('sniper');
  if (n >= 5) pool.push('ronin');
  if (n >= 6) pool.push('bombard');
  return pool;
}

export function objectiveFor(n, rng) {
  if (n <= 2) return 'eliminate';
  if (n === 3) return 'hold';
  if (n === 4) return 'assassinate';
  return rng.pick(['eliminate', 'eliminate', 'hold', 'assassinate']);
}

// Pick a roster within budget. Returns [{ cls, veteran, elite, commander }].
export function rosterFor(n, rng, objective) {
  const pool = poolFor(n);
  const out = [];
  let budget = budgetFor(n);
  if (objective === 'assassinate') {
    out.push({ cls: rng.pick(pool.filter((c) => c !== 'sniper')), elite: true, commander: true });
    budget -= 2;
  } else if (n >= 7 && rng.next() < Math.min(0.8, 0.2 + (n - 7) * 0.1) && budget >= 3) {
    out.push({ cls: rng.pick(pool), elite: true });
    budget -= 2;
  }
  const vetChance = n >= 5 ? Math.min(0.5, 0.15 + (n - 5) * 0.05) : 0;
  let guard = 0;
  while (budget >= 0.99 && out.length < 8 && guard++ < 50) {
    // Grunts arrive in pairs.
    if (rng.next() < 0.3 || budget < 1) {
      out.push({ cls: 'grunt' }, { cls: 'grunt' });
      budget -= 1;
      continue;
    }
    const cls = rng.pick(pool);
    const vet = rng.next() < vetChance && budget >= 1.5;
    out.push({ cls, veteran: vet });
    budget -= vet ? 1.5 : 1;
  }
  if (budget >= 0.5 && out.length < 8) out.push({ cls: 'grunt' });
  return out;
}

function makeMap(rng, keepClear) {
  // Scatter short wall segments through the middle rows.
  const terrain = new Set();
  const segs = 5 + Math.floor(rng.next() * 3);
  for (let i = 0; i < segs; i++) {
    let h = offsetToAxial(Math.floor(rng.next() * W), 2 + Math.floor(rng.next() * 6));
    const len = 1 + Math.floor(rng.next() * 3);
    for (let j = 0; j < len; j++) {
      const { col, row } = { col: h.q + (h.r - (h.r & 1)) / 2, row: h.r };
      if (col >= 0 && col < W && row >= 2 && row <= 7 && !keepClear.has(key(h))) terrain.add(key(h));
      h = rng.pick(neighbors(h));
    }
  }
  return terrain;
}

function connected(terrain) {
  // Every open hex must be reachable from the player's start.
  const open = [];
  for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
    const h = offsetToAxial(col, row);
    if (!terrain.has(key(h))) open.push(key(h));
  }
  const openSet = new Set(open);
  const start = key(offsetToAxial(3, 9));
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const [a, b] = q.shift().split(',').map(Number);
    for (const n of neighbors({ q: a, r: b })) {
      const k = key(n);
      if (openSet.has(k) && !seen.has(k)) { seen.add(k); q.push(k); }
    }
  }
  return seen.size === open.length;
}

const BRIEFS = {
  eliminate: 'Destroy all hostile mechs.',
  hold: 'Hold the marked zone: end 4 rounds inside it. Reinforcements are inbound.',
  assassinate: 'Destroy the enemy Commander (marked ★). The rest can live.',
};

export function generateMission(n, rng) {
  const objectiveType = objectiveFor(n, rng);
  const tier = tierFor(n);
  const zone = objectiveType === 'hold'
    ? [offsetToAxial(3, 4), offsetToAxial(4, 4), offsetToAxial(3, 5), offsetToAxial(4, 5)]
    : [];
  const keepClear = new Set([...zone.map(key), key(offsetToAxial(3, 9))]);
  let terrain;
  do terrain = makeMap(rng, keepClear); while (!connected(terrain));

  const roster = rosterFor(n, rng, objectiveType);
  const spots = [];
  for (let row = 0; row <= 2; row++) for (let col = 0; col < W; col++) {
    const h = offsetToAxial(col, row);
    if (!terrain.has(key(h))) spots.push(h);
  }
  const units = [makePlayer(offsetToAxial(3, 9))];
  let targetId = null;
  for (const r of roster) {
    if (!spots.length) break;
    const h = spots.splice(Math.floor(rng.next() * spots.length), 1)[0];
    const npc = makeNpc(r.cls, h, { tier, veteran: r.veteran, elite: r.elite, commander: r.commander });
    if (r.commander) targetId = npc.id;
    units.push(npc);
  }
  const objective = { type: objectiveType, targetId, tier };
  if (objectiveType === 'hold') {
    Object.assign(objective, {
      holdNeeded: 4,
      reinforcementsLeft: 1 + Math.floor(n / 5),
      reinforcement: n >= 8 ? ['grunt', 'grunt', 'assault'] : ['grunt', 'grunt'],
    });
  }
  const state = makeState({
    rng, width: W, height: H,
    terrain: [...terrain].map((k) => { const [q, r] = k.split(',').map(Number); return { q, r }; }),
    zone, units, objective,
  });
  const name = `Operation ${NAMES[(n * 7 + Math.floor(rng.next() * NAMES.length)) % NAMES.length]}`;
  const summary = summarize(units.filter((u) => u.side === 'enemy'));
  return { n, name, tier, brief: BRIEFS[objectiveType], summary, state };
}

function summarize(npcs) {
  const counts = {};
  for (const u of npcs) counts[u.name] = (counts[u.name] || 0) + 1;
  return Object.entries(counts).map(([k, v]) => (v > 1 ? `${v}× ${k}` : k)).join(', ');
}

export const CLASS_NAMES = Object.fromEntries(Object.entries(NPC_CLASSES).map(([k, v]) => [k, v.name]));
