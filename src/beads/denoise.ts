export function lab(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function distance(a: number[], b: number[]) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
type Pixels = (number[] | null)[];
function neighborhood(
  index: number,
  width: number,
  height: number,
  radius: number,
) {
  const result: number[] = [],
    x = index % width,
    y = Math.floor(index / width);
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      if (
        (!dx && !dy) ||
        x + dx < 0 ||
        x + dx >= width ||
        y + dy < 0 ||
        y + dy >= height
      )
        continue;
      result.push((y + dy) * width + x + dx);
    }
  return result;
}
/** Remove unsupported chroma impulses, not dark eyes or bright highlights. Each
 * decision uses an immutable neighborhood; transparent cells never vote. */
export function smoothPhoto(
  pixels: Pixels,
  width: number,
  height: number,
  strength: number,
): Pixels {
  if (!strength) return pixels;
  const labs = pixels.map((p) => p && lab(p));
  const corrected = pixels.map((rgb, index) => {
    if (!rgb) return null;
    const center = labs[index]!;
    const near = neighborhood(
      index,
      width,
      height,
      strength === 2 ? 2 : 1,
    ).filter((i) => labs[i]);
    if (near.length < 5) return rgb;
    // An actual local sample represents the surrounding colour; independent RGB
    // medians can invent a hue that did not occur in the source.
    let representative = near[0],
      cost = Infinity;
    for (const i of near) {
      const score = near.reduce(
        (sum, j) => sum + Math.min(distance(labs[i]!, labs[j]!), 900),
        0,
      );
      if (score < cost) {
        cost = score;
        representative = i;
      }
    }
    const base = labs[representative]!;
    const support = near.filter((i) => distance(labs[i]!, base) < 144).length;
    const similar = near.filter((i) => distance(labs[i]!, center) < 144).length;
    const chroma = (center[1] - base[1]) ** 2 + (center[2] - base[2]) ** 2;
    return support >= Math.ceil(near.length * 0.7) &&
      similar <= (strength === 2 ? 2 : 0) &&
      Math.abs(center[0] - base[0]) < (strength === 2 ? 16 : 11) &&
      chroma > (strength === 2 ? 225 : 400)
      ? pixels[representative]
      : rgb;
  });
  const guide = corrected.map((p) => p && lab(p));
  const radius = strength === 2 ? 2 : 1;
  return corrected.map((rgb, index) => {
    if (!rgb) return null;
    const sum = [...rgb];
    let total = 1;
    const x = index % width,
      y = Math.floor(index / width);
    for (const i of neighborhood(index, width, height, radius)) {
      if (!corrected[i]) continue;
      const dx = (i % width) - x,
        dy = Math.floor(i / width) - y;
      const weight = Math.exp(
        -distance(guide[index]!, guide[i]!) / (strength === 2 ? 288 : 128) -
          (dx * dx + dy * dy) / (strength === 2 ? 4 : 2),
      );
      total += weight;
      for (let c = 0; c < 3; c++) sum[c] += corrected[i]![c] * weight;
    }
    return sum.map((v) => v / total);
  });
}
/** Edge-aware label regularization. A neighbour can only suggest an existing
 * palette colour, and the maximum extra source error is explicitly bounded. */
export function regularizeLabels(
  cells: number[],
  pixels: Pixels,
  palette: number[][],
  width: number,
  height: number,
  strength: number,
  metric = distance,
) {
  if (!strength) return cells;
  const guide = pixels.map((p) => p && lab(p));
  const links = cells.map((color, index) =>
    color < 0
      ? []
      : neighborhood(index, width, height, 1)
          .filter((i) => cells[i] >= 0)
          .map((i) => ({
            i,
            weight:
              Math.exp(-distance(guide[index]!, guide[i]!) / 288) *
              (i % width !== index % width &&
              Math.floor(i / width) !== Math.floor(index / width)
                ? Math.SQRT1_2
                : 1),
          })),
  );
  const result = [...cells],
    penalty = strength === 2 ? 55 : 24;
  for (let pass = 0; pass < (strength === 2 ? 4 : 2); pass++) {
    let changes = 0;
    // Alternating sweep directions reduce directional bias; accept only strict
    // energy improvements, avoiding synchronous checkerboard oscillations.
    for (let step = 0; step < result.length; step++) {
      const index = pass % 2 ? result.length - 1 - step : step;
      const current = result[index];
      if (current < 0) continue;
      const baseError = metric(guide[index]!, palette[cells[index]]);
      const score = (color: number) =>
        metric(guide[index]!, palette[color]) +
        penalty *
          links[index].reduce(
            (sum, link) => sum + (result[link.i] === color ? 0 : link.weight),
            0,
          );
      let best = current,
        bestScore = score(current);
      for (const candidate of new Set(
        links[index].map((link) => result[link.i]),
      )) {
        if (
          candidate === current ||
          metric(guide[index]!, palette[candidate]) >
            baseError + (strength === 2 ? 144 : 64)
        )
          continue;
        const nextScore = score(candidate);
        if (nextScore + 0.001 < bestScore) {
          best = candidate;
          bestScore = nextScore;
        }
      }
      if (best !== current) {
        result[index] = best;
        changes++;
      }
    }
    if (!changes) break;
  }
  return result;
}
