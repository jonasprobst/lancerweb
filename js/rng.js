// Seeded RNG (mulberry32) so fights are reproducible in tests.
export function makeRng(seed = Date.now()) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const die = (n) => 1 + Math.floor(next() * n);
  return {
    next,
    die,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // Parse "1d6+3", "2d6", "1d3", or a plain number. Returns { total, rolls }.
    roll(expr) {
      if (typeof expr === 'number') return { total: expr, rolls: [] };
      const m = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(String(expr).trim());
      if (!m) return { total: Number(expr) || 0, rolls: [] };
      const rolls = [];
      for (let i = 0; i < +m[1]; i++) rolls.push(die(+m[2]));
      return { total: rolls.reduce((a, b) => a + b, 0) + (+m[3] || 0), rolls };
    },
  };
}

export function isDiceExpr(expr) {
  return typeof expr === 'string' && /d/.test(expr);
}
