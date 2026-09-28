import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../js/rng.js';
import { distance, line, offsetToAxial, axialToOffset } from '../js/hex.js';
import {
  makeState, makePlayer, makeNpc, reachable, hitChance, dealDamage, addHeat, coverFor,
  attackMods, canQuick, canFull, spendQuick, spendFull, startPlayerTurn, overcharge, key,
} from '../js/engine.js';
import { MECH, PLAYER_WEAPONS } from '../js/data.js';
import { generateMission, budgetFor } from '../js/missions.js';
import { autoBattle, autoIo } from '../js/autoplay.js';

const io = autoIo();
const takeIo = { ...io, ask: async (_q, o) => (o.find((x) => x.value === 'take') ? 'take' : o[0].value) };
const at = (c, r) => offsetToAxial(c, r);

function setup(extra = {}) {
  const p = makePlayer(at(3, 8));
  const e = makeNpc('assault', at(3, 4));
  const s = makeState({ rng: makeRng(1), units: [p, e], ...extra });
  return { s, p, e };
}

test('Vail\'s mech stats match the build', () => {
  assert.equal(MECH.maxHp, 16); // 10 + 2×Hull 2 + Personalizations
  assert.equal(MECH.repairs, 6);
  assert.equal(MECH.heatCap, 6);
  assert.equal(PLAYER_WEAPONS.blade.damage, '1d6+3');
  assert.equal(PLAYER_WEAPONS.shotgun.threat, 3);
});

test('hex offset round-trip and distance', () => {
  for (let r = 0; r < 10; r++) for (let c = 0; c < 8; c++) {
    assert.deepEqual(axialToOffset(offsetToAxial(c, r)), { col: c, row: r });
  }
  assert.equal(distance(at(0, 0), at(0, 1)), 1);
  assert.equal(line(at(0, 0), at(4, 0)).length, 5);
});

test('hit chance math', () => {
  assert.ok(Math.abs(hitChance(0, 0, 11) - 0.5) < 1e-9);
  assert.ok(hitChance(0, 1, 11) > 0.5);
  assert.ok(hitChance(0, -2, 11) < hitChance(0, -1, 11));
  assert.ok(Math.abs(hitChance(0, 0, 1) - 1) < 1e-9);
});

test('armor, AP and Exposed', async () => {
  const { s, p, e } = setup();
  await dealDamage(s, io, e, 5, 'Kinetic', {});
  assert.equal(e.hp, 10 - 4); // armor 1
  await dealDamage(s, io, e, 5, 'Energy', { ap: true });
  assert.equal(e.hp, 1);
  p.statuses.exposed = Infinity;
  await dealDamage(s, io, p, 3, 'Kinetic', {});
  assert.equal(p.hp, 16 - 6);
});

test('NPC dies at 0 HP; player loses structure and resets HP', async () => {
  const { s, p, e } = setup();
  await dealDamage(s, io, e, 50, 'Kinetic', {});
  assert.equal(e.destroyed, true);
  p.paintUsed = true;
  await dealDamage(s, takeIo, p, 20, 'Kinetic', {});
  assert.equal(p.structure, 3);
  assert.ok(p.hp > 0);
});

test('Brace halves the hit that would cost structure', async () => {
  const { s, p, e } = setup();
  p.paintUsed = true;
  await dealDamage(s, io, p, 20, 'Kinetic', { attacker: e });
  assert.equal(p.structure, 4);
  assert.equal(p.hp, 6);
  assert.equal(p.reaction, false);
  startPlayerTurn(s, io);
  assert.equal(s.turn.base, 1);
  assert.equal(s.turn.moved, true);
});

test('heat past the cap marks stress and carries excess', async () => {
  const { s, p } = setup();
  await addHeat(s, io, p, 8, 'test');
  assert.equal(p.stress, 3);
  assert.equal(p.heat, 2);
});

test('overcharge escalates 1, 1d3, 1d6, 1d6+4', async () => {
  const { s, p } = setup();
  startPlayerTurn(s, io);
  await overcharge(s, io);
  assert.equal(p.heat, 1);
  assert.equal(s.turn.bonus, 1);
});

test('becoming Engaged stops movement', () => {
  const p = makePlayer(at(3, 8));
  const e = makeNpc('berserker', at(3, 6));
  const s = makeState({ rng: makeRng(2), units: [p, e] });
  const r = reachable(s, p, 4);
  // No reachable hex should require passing through a hex adjacent to the berserker.
  for (const [, o] of r) {
    const mid = o.path.slice(1, -1);
    assert.ok(mid.every((h) => distance(h, e.pos) > 1), 'moved through engagement');
  }
  assert.ok(reachable(s, p, 4, { ignoreEngagement: true }).size > r.size);
});

test('walls give hard cover against ranged but not melee', () => {
  const p = makePlayer(at(3, 8));
  const e = makeNpc('assault', at(3, 4));
  const wall = line(e.pos, p.pos)[3];
  const s = makeState({ rng: makeRng(3), units: [p, e], terrain: [wall] });
  assert.equal(distance(wall, p.pos), 1);
  assert.equal(coverFor(s, e.pos, p, { type: 'Ranged' }).value, 2);
  assert.equal(coverFor(s, e.pos, p, { type: 'Melee' }).value, 0);
  const m = attackMods(s, e, p, e.weapons[0]);
  assert.equal(m.net, -2);
});

test('action economy: no repeats without overcharge, full needs both actions', async () => {
  const { s } = setup();
  startPlayerTurn(s, io);
  assert.ok(canFull(s, 'barrage'));
  spendQuick(s, 'skirmish');
  assert.ok(!canFull(s, 'barrage'));
  assert.ok(!canQuick(s, 'skirmish'));
  assert.ok(canQuick(s, 'boost'));
  await overcharge(s, io);
  assert.ok(canQuick(s, 'skirmish'));
  startPlayerTurn(s, io);
  spendFull(s, 'barrage');
  assert.ok(!canQuick(s, 'boost'));
});

test('missions get harder', () => {
  for (let n = 1; n < 8; n++) assert.ok(budgetFor(n + 1) > budgetFor(n));
  const m1 = generateMission(1, makeRng(5));
  const m8 = generateMission(8, makeRng(5));
  const hp = (m) => m.state.units.filter((u) => u.side === 'enemy').reduce((a, u) => a + u.maxHp, 0);
  assert.ok(hp(m8) > hp(m1));
  assert.ok(m1.state.units.every((u) => !m1.state.terrain.has(key(u.pos))));
});

test('full battles run to completion', async () => {
  for (let n = 1; n <= 10; n++) {
    const m = generateMission(n, makeRng(100 + n));
    const r = await autoBattle(m.state, io);
    assert.ok(['win', 'lose'].includes(r), `mission ${n}: ${r}`);
  }
});
