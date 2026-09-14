import { MAX_COLORS, validSize, type BeadPattern } from "./model";

export interface ConvertOptions {
  width: number;
  height: number;
  mode: "pixel" | "photo";
  colors: number;
  cleanup: number;
}
type Point = { rgb: number[]; lab: number[]; weight: number };
function lab(rgb: number[]) {
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
function distance(a: number[], b: number[]) {
  return a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
}
function nearest(value: number[], centers: number[][]) {
  let best = 0,
    score = Infinity;
  centers.forEach((center, i) => {
    const d = distance(value, center);
    if (d < score) {
      score = d;
      best = i;
    }
  });
  return best;
}
function hex(rgb: number[]) {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

// Input is already resampled to the requested bead grid. Runs off the UI thread.
export function convertImage(
  data: Uint8ClampedArray,
  options: ConvertOptions,
): BeadPattern {
  const { width, height, mode } = options;
  if (
    !validSize(width) ||
    !validSize(height) ||
    data.length !== width * height * 4
  )
    throw new Error("图片网格尺寸无效");
  const pixels: (number[] | null)[] = Array.from(
    { length: width * height },
    (_, i) =>
      data[i * 4 + 3] < 128 ? null : Array.from(data.slice(i * 4, i * 4 + 3)),
  );
  if (mode === "pixel") {
    const colors: string[] = [],
      lookup = new Map<string, number>();
    const cells = pixels.map((rgb) => {
      if (!rgb) return -1;
      const key = hex(rgb);
      if (!lookup.has(key)) {
        lookup.set(key, colors.length);
        colors.push(key);
      }
      return lookup.get(key)!;
    });
    if (colors.length > MAX_COLORS)
      throw new Error(
        "原稿超过 256 色，请使用照片转换减少颜色，或导入无抗锯齿的像素原稿",
      );
    return {
      version: 1,
      title: "像素原稿",
      width,
      height,
      cells,
      palette: (colors.length ? colors : ["#263b46"]).map((h, i) => ({
        hex: h,
        name: `颜色 ${i + 1}`,
      })),
    };
  }
  // Small bilateral filter: smooth close tones without averaging across strong edges.
  const smooth = pixels.map((rgb, index) => {
    if (!rgb || !options.cleanup) return rgb;
    const x = index % width,
      y = Math.floor(index / width),
      sum = [0, 0, 0];
    let weights = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height)
          continue;
        const other = pixels[(y + dy) * width + x + dx];
        if (!other) continue;
        const weight = Math.exp(
          -distance(rgb, other) / (options.cleanup === 2 ? 1800 : 800) -
            (dx * dx + dy * dy) / 2,
        );
        weights += weight;
        other.forEach((v, j) => (sum[j] += v * weight));
      }
    return sum.map((v) => v / weights);
  });
  // Five-bit histogram bounds clustering work and makes results deterministic.
  const histogram = new Map<number, { sum: number[]; weight: number }>();
  smooth.forEach((rgb) => {
    if (!rgb) return;
    const key =
      (Math.round(rgb[0]) >> 3) * 1024 +
      (Math.round(rgb[1]) >> 3) * 32 +
      (Math.round(rgb[2]) >> 3);
    const bin = histogram.get(key) ?? { sum: [0, 0, 0], weight: 0 };
    bin.weight++;
    rgb.forEach((v, i) => (bin.sum[i] += v));
    histogram.set(key, bin);
  });
  const points: Point[] = Array.from(histogram.values())
    .map((bin) => {
      const rgb = bin.sum.map((v) => v / bin.weight);
      return { rgb, lab: lab(rgb), weight: bin.weight };
    })
    .sort((a, b) => b.weight - a.weight);
  if (!points.length)
    return {
      version: 1,
      title: "图片转图",
      width,
      height,
      cells: pixels.map(() => -1),
      palette: [{ hex: "#263b46", name: "颜色 1" }],
    };
  const maxColors = Math.max(2, Math.min(48, Math.round(options.colors) || 16));
  let centers = [points[0].lab];
  const minDistances = points.map((p) => distance(p.lab, centers[0]));
  while (centers.length < Math.min(maxColors, points.length)) {
    let best = 0,
      score = 0;
    points.forEach((p, i) => {
      const candidate = minDistances[i] * Math.sqrt(p.weight);
      if (candidate > score) {
        score = candidate;
        best = i;
      }
    });
    if (minDistances[best] < 9) break;
    centers.push(points[best].lab);
    points.forEach(
      (p, i) =>
        (minDistances[i] = Math.min(
          minDistances[i],
          distance(p.lab, centers[centers.length - 1]),
        )),
    );
  }
  for (let pass = 0; pass < 10; pass++) {
    const sums = centers.map(() => [0, 0, 0]),
      weights = centers.map(() => 0);
    points.forEach((p) => {
      const i = nearest(p.lab, centers);
      weights[i] += p.weight;
      p.lab.forEach((v, j) => (sums[i][j] += v * p.weight));
    });
    const next = sums.map((sum, i) =>
      weights[i] ? sum.map((v) => v / weights[i]) : centers[i],
    );
    const movement = next.reduce(
      (sum, c, i) => sum + distance(c, centers[i]),
      0,
    );
    centers = next;
    if (movement < 0.01) break;
  }
  // Choose real sampled colors as representatives; merge perceptually redundant tones.
  const representatives = centers.map((c) =>
    points.reduce((a, b) => (distance(a.lab, c) < distance(b.lab, c) ? a : b)),
  );
  const palettePoints: Point[] = [];
  representatives.forEach((p) => {
    if (
      !palettePoints.some(
        (q) => distance(p.lab, q.lab) < (options.cleanup === 2 ? 49 : 16),
      )
    )
      palettePoints.push(p);
  });
  const paletteLab = palettePoints.map((p) => p.lab);
  let cells = smooth.map((rgb) => (rgb ? nearest(lab(rgb), paletteLab) : -1));
  if (options.cleanup) {
    const source = cells;
    cells = source.map((color, index) => {
      if (color < 0) return color;
      const x = index % width,
        y = Math.floor(index / width),
        neighbors = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (
            (!dx && !dy) ||
            x + dx < 0 ||
            x + dx >= width ||
            y + dy < 0 ||
            y + dy >= height
          )
            continue;
          const c = source[(y + dy) * width + x + dx];
          if (c >= 0) neighbors.set(c, (neighbors.get(c) ?? 0) + 1);
        }
      const majority = [...neighbors].sort((a, b) => b[1] - a[1])[0];
      return majority &&
        majority[1] >= 5 &&
        (neighbors.get(color) ?? 0) <= 1 &&
        distance(paletteLab[color], paletteLab[majority[0]]) <
          (options.cleanup === 2 ? 225 : 100)
        ? majority[0]
        : color;
    });
  }
  return {
    version: 1,
    title: "图片转图",
    width,
    height,
    cells,
    palette: palettePoints.map((p, i) => ({
      hex: hex(p.rgb),
      name: `颜色 ${i + 1}`,
    })),
  };
}
