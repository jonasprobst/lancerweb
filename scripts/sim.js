// Balance check: the scripted pilot plays each mission many times.
// Usage: node scripts/sim.js [missions=12] [runs=200]
import { makeRng } from '../js/rng.js';
import { generateMission } from '../js/missions.js';
import { autoBattle, autoIo } from '../js/autoplay.js';

const missions = +(process.argv[2] || 12);
const runs = +(process.argv[3] || 200);
for (let n = 1; n <= missions; n++) {
  const tally = { win: 0, lose: 0, timeout: 0 };
  let rounds = 0;
  for (let i = 0; i < runs; i++) {
    const m = generateMission(n, makeRng(n * 10007 + i));
    const r = await autoBattle(m.state, autoIo());
    tally[r] += 1;
    rounds += m.state.round;
  }
  console.log(`M${String(n).padStart(2)}  win ${(100 * tally.win / runs).toFixed(0).padStart(3)}%  lose ${(100 * tally.lose / runs).toFixed(0).padStart(3)}%  timeout ${tally.timeout}  avg rounds ${(rounds / runs).toFixed(1)}`);
}
