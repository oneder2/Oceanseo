import { occupiedBounds, validSize, type BeadPattern } from "./model";

function neighbors(i: number, width: number, height: number, diagonal = false) {
  const x = i % width,
    y = Math.floor(i / width);
  const result: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || (!diagonal && dx && dy)) continue;
      const nx = x + dx,
        ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height)
        result.push(ny * width + nx);
    }
  return result;
}
function validateColor(p: BeadPattern, color: number) {
  if (!Number.isInteger(color) || color < 0 || color >= p.palette.length)
    throw new Error("请先选择有效豆色");
}

/** Four-connected flood fill. Diagonal contact does not join two regions. */
export function floodFill(
  p: BeadPattern,
  x: number,
  y: number,
  color: number,
): BeadPattern {
  validateColor(p, color);
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= p.width ||
    y >= p.height
  )
    return p;
  const start = y * p.width + x,
    target = p.cells[start];
  if (target === color) return p;
  const cells = [...p.cells],
    queue = [start];
  cells[start] = color;
  for (let head = 0; head < queue.length; head++) {
    for (const n of neighbors(queue[head], p.width, p.height)) {
      if (cells[n] !== target) continue;
      cells[n] = color;
      queue.push(n);
    }
  }
  return { ...p, cells };
}

/** Empty cells reachable from the canvas edge are background, never holes. */
function exterior(p: BeadPattern) {
  const seen = new Uint8Array(p.cells.length),
    queue: number[] = [];
  p.cells.forEach((c, i) => {
    const x = i % p.width,
      y = Math.floor(i / p.width);
    if (
      c < 0 &&
      (x === 0 || y === 0 || x === p.width - 1 || y === p.height - 1)
    ) {
      seen[i] = 1;
      queue.push(i);
    }
  });
  for (let head = 0; head < queue.length; head++) {
    for (const n of neighbors(queue[head], p.width, p.height)) {
      if (seen[n] || p.cells[n] >= 0) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}
export function fillHoles(p: BeadPattern, color: number): BeadPattern {
  validateColor(p, color);
  const outside = exterior(p);
  let changed = false;
  const cells = p.cells.map((c, i) => {
    if (c >= 0 || outside[i]) return c;
    changed = true;
    return color;
  });
  return changed ? { ...p, cells } : p;
}

/** Grow only the exterior silhouette, preserving existing beads and inner holes. */
export function thickenOutline(
  p: BeadPattern,
  color: number,
  layers: number,
  expand: boolean,
): BeadPattern {
  validateColor(p, color);
  if (!Number.isInteger(layers) || layers < 1 || layers > 8)
    throw new Error("加边厚度需要在 1–8 格之间");
  const b = occupiedBounds(p);
  if (!b) return p;
  const left = expand ? Math.max(0, layers - b.left) : 0;
  const top = expand ? Math.max(0, layers - b.top) : 0;
  const right = expand ? Math.max(0, layers - (p.width - 1 - b.right)) : 0;
  const bottom = expand ? Math.max(0, layers - (p.height - 1 - b.bottom)) : 0;
  const width = p.width + left + right,
    height = p.height + top + bottom;
  if (!validSize(width) || !validSize(height))
    throw new Error("加边后超过 160×160 格，请减少厚度或关闭自动扩展画布");
  const cells = Array<number>(width * height).fill(-1);
  p.cells.forEach((c, i) => {
    cells[(Math.floor(i / p.width) + top) * width + (i % p.width) + left] = c;
  });
  const next = { ...p, width, height, cells },
    outside = exterior(next);
  let frontier = cells.flatMap((c, i) => (c >= 0 ? [i] : []));
  let added = 0;
  for (let step = 0; step < layers; step++) {
    const following: number[] = [];
    for (const i of frontier)
      for (const n of neighbors(i, width, height, true)) {
        if (cells[n] >= 0 || !outside[n]) continue;
        cells[n] = color;
        following.push(n);
        added++;
      }
    frontier = following;
  }
  return added ? next : p;
}
