// Axial hex helpers (pointy-top). A hex is { q, r }.
export const key = (h) => `${h.q},${h.r}`;
export const fromKey = (k) => {
  const [q, r] = k.split(',').map(Number);
  return { q, r };
};

const DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export const neighbors = (h) => DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));

export function distance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export const same = (a, b) => a.q === b.q && a.r === b.r;

// Offset "odd-r" grid (col,row) <-> axial.
export const offsetToAxial = (col, row) => ({ q: col - (row - (row & 1)) / 2, r: row });
export const axialToOffset = (h) => ({ col: h.q + (h.r - (h.r & 1)) / 2, row: h.r });

function cubeRound(x, y, z) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

// Hexes on the straight line from a to b, inclusive of both ends.
export function line(a, b) {
  const n = distance(a, b);
  if (n === 0) return [{ ...a }];
  const out = [];
  const eps = 1e-6;
  const ax = a.q + eps, az = a.r + eps, ay = -ax - az;
  const bx = b.q + eps, bz = b.r + eps, by = -bx - bz;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(cubeRound(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t));
  }
  return out;
}

// Extend the line from a through b out to `len` hexes from a (excluding a).
export function ray(a, b, len) {
  const d = distance(a, b);
  if (d === 0) return [];
  const scale = len / d;
  const far = { q: a.q + (b.q - a.q) * scale, r: a.r + (b.r - a.r) * scale };
  const n = len;
  const out = [];
  const eps = 1e-6;
  const ax = a.q + eps, az = a.r + eps, ay = -ax - az;
  const bx = far.q + eps, bz = far.r + eps, by = -bx - bz;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    out.push(cubeRound(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t));
  }
  return out;
}

// Pixel centre of a hex for rendering (pointy-top, size = corner radius).
export function toPixel(h, size) {
  return {
    x: size * Math.sqrt(3) * (h.q + h.r / 2),
    y: size * 1.5 * h.r,
  };
}
