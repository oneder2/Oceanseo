import { lab, distance } from "./denoise";

type Pixels = (number[] | null)[];
const dot = (a: number[], b: number[]) =>
  a.reduce((n, v, i) => n + v * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);

// Area filtering / antialiasing creates convex RGB mixtures at two- and
// three-region junctions. Test the mixture in RGB, then its perceptual error.
function blended(color: number[], neighbors: number[][], tolerance: number) {
  const plausible = (mix: number[]) =>
    distance(lab(color), lab(mix)) < tolerance;
  for (let i = 0; i < neighbors.length; i++) {
    for (let j = i + 1; j < neighbors.length; j++) {
      const a = neighbors[i],
        u = sub(neighbors[j], a),
        q = sub(color, a);
      const uu = dot(u, u);
      if (uu < 900) continue;
      const t = dot(q, u) / uu;
      if (t > 0.06 && t < 0.94 && plausible(a.map((v, c) => v + t * u[c])))
        return true;
      for (let k = j + 1; k < neighbors.length; k++) {
        const v = sub(neighbors[k], a),
          vv = dot(v, v),
          uv = dot(u, v);
        const det = uu * vv - uv * uv;
        if (det < 1) continue;
        const s = (dot(q, u) * vv - dot(q, v) * uv) / det;
        const t = (dot(q, v) * uu - dot(q, u) * uv) / det;
        if (
          s >= 0.06 &&
          t >= 0.06 &&
          s + t <= 0.94 &&
          plausible(a.map((n, c) => n + s * u[c] + t * v[c]))
        )
          return true;
      }
    }
  }
  return false;
}

/** A second, region-based pass AFTER final manufacturer-colour assignment.
 * Thin transition ribbons can be arbitrarily long, unlike isolated-pixel noise.
 * Decisions use a frozen pass, four-connected regions and nearby solid support.
 * Never fill transparency, introduce a colour, or erase luminance extrema. */
export function cleanBoundaryRegions(
  input: number[],
  pixels: Pixels,
  width: number,
  height: number,
  strength: number,
): number[] {
  if (!strength) return input;
  let cells = [...input];
  const neighbors = (i: number) => {
    const x = i % width,
      y = Math.floor(i / width);
    return [
      x > 0 ? i - 1 : -1,
      x + 1 < width ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y + 1 < height ? i + width : -1,
    ].filter((n) => n >= 0 && cells[n] >= 0);
  };
  for (let pass = 0; pass < 2; pass++) {
    const region = new Int32Array(cells.length).fill(-1);
    const groups: { indices: number[]; cores: number; rgb: number[] }[] = [];
    for (let seed = 0; seed < cells.length; seed++) {
      if (cells[seed] < 0 || region[seed] >= 0) continue;
      const id = groups.length,
        indices = [seed],
        sum = [0, 0, 0];
      region[seed] = id;
      let cores = 0;
      for (let at = 0; at < indices.length; at++) {
        const i = indices[at],
          near = neighbors(i);
        if (near.length >= 3 && near.every((n) => cells[n] === cells[i]))
          cores++;
        pixels[i]!.forEach((v, c) => (sum[c] += v));
        for (const n of near)
          if (region[n] < 0 && cells[n] === cells[seed]) {
            region[n] = id;
            indices.push(n);
          }
      }
      groups.push({ indices, cores, rgb: sum.map((v) => v / indices.length) });
    }
    const next = [...cells];
    let changes = 0;
    for (let id = 0; id < groups.length; id++) {
      const group = groups[id];
      // A real solid patch is not a transition fringe. Long one-/two-bead
      // lines have no interior but survive unless they match a colour mixture.
      if (group.cores > Math.max(0, Math.floor(group.indices.length * 0.04)))
        continue;
      const updates: [number, number][] = [];
      for (const i of group.indices) {
        const x = i % width,
          y = Math.floor(i / width);
        const candidates = new Map<
          number,
          { votes: number; nearest: number }
        >();
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height)
              continue;
            const n = (y + dy) * width + x + dx,
              other = region[n];
            if (other < 0 || other === id || !groups[other].cores) continue;
            const old = candidates.get(other) ?? { votes: 0, nearest: 99 };
            old.votes++;
            old.nearest = Math.min(old.nearest, dx * dx + dy * dy);
            candidates.set(other, old);
          }
        const choices = [...candidates]
          .filter(([, c]) => c.votes >= 3)
          .sort((a, b) => b[1].votes - a[1].votes)
          .slice(0, 5);
        if (!choices.length) continue;
        const rgb = pixels[i]!,
          light = lab(rgb)[0];
        const samples = choices.map(([r]) => groups[r].rgb);
        const lights = samples.map((c) => lab(c)[0]);
        const extreme =
          light < Math.min(...lights) - 14 || light > Math.max(...lights) + 14;
        if (extreme) continue;
        const seam =
          samples.length >= 2 &&
          blended(rgb, samples, strength === 2 ? 100 : 36);
        const fleck =
          strength === 2 &&
          group.indices.length <= 4 &&
          choices.reduce((n, [, c]) => n + c.votes, 0) >= 12 &&
          Math.min(...lights.map((l) => Math.abs(l - light))) < 14;
        if (!seam && !fleck) continue;
        const guide = lab(rgb);
        const adjacent = choices.filter(([, c]) => c.nearest === 1);
        if (!adjacent.length) continue;
        const chosen = adjacent.reduce((a, b) => {
          const score = ([r, c]: typeof a) =>
            distance(guide, lab(groups[r].rgb)) + c.nearest * 24 - c.votes * 2;
          return score(a) <= score(b) ? a : b;
        });
        updates.push([i, cells[groups[chosen[0]].indices[0]]]);
      }
      // Never break an ambiguous thin feature into leftover isolated fragments.
      // Each removed region must be fully explained and join adjacent solid ink.
      if (updates.length === group.indices.length) {
        for (const [i, color] of updates) next[i] = color;
        changes += updates.length;
      }
    }
    cells = next;
    if (!changes) break;
  }
  return cells;
}
