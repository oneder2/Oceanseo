import { MAX_COLORS, validSize, type BeadPattern } from "./model";
import { distance, lab, smoothPhoto, regularizeLabels } from "./denoise";
import { colorDistance } from "./colorDistance";
import {
  compactPalette,
  isBrand,
  mapPatternToBrand,
  matchPalette,
  rgbOf,
  type BeadBrand,
} from "./palettes";

export interface ConvertOptions {
  width: number;
  height: number;
  mode: "pixel" | "photo";
  colors: number;
  cleanup: number;
  brand?: BeadBrand | "custom";
}
type Point = { rgb: number[]; lab: number[]; weight: number };
function nearest(value: number[], centers: number[][], metric = distance) {
  let best = 0,
    score = Infinity;
  centers.forEach((center, i) => {
    const d = metric(value, center);
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
  const { width, height, mode, brand } = options;
  if (brand !== undefined && brand !== "custom" && !isBrand(brand))
    throw new Error("不支持的拼豆品牌");
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
    const pattern: BeadPattern = {
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
    return isBrand(brand) ? mapPatternToBrand(pattern, brand) : pattern;
  }
  const smooth = smoothPhoto(pixels, width, height, options.cleanup);
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
  const clusters: Point[][] = centers.map(() => []);
  points.forEach((p) => clusters[nearest(p.lab, centers)].push(p));
  const representatives = clusters.flatMap((group, i) =>
    group.length
      ? [
          group.reduce((a, b) =>
            distance(a.lab, centers[i]) <= distance(b.lab, centers[i]) ? a : b,
          ),
        ]
      : [],
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
  let palette = palettePoints.map((p, i) => ({
    hex: hex(p.rgb),
    name: `颜色 ${i + 1}`,
  }));
  if (isBrand(brand)) palette = matchPalette(palette, brand);
  palette = palette.filter(
    (c, i) => palette.findIndex((v) => v.hex === c.hex) === i,
  );
  const paletteLab = palette.map((c) => lab(rgbOf(c.hex)));
  const metric = isBrand(brand) ? colorDistance : distance;
  const initial = smooth.map((rgb) =>
    rgb ? nearest(lab(rgb), paletteLab, metric) : -1,
  );
  const cells = regularizeLabels(
    initial,
    smooth,
    paletteLab,
    width,
    height,
    options.cleanup,
    metric,
  );
  return compactPalette({
    version: 1,
    title: "图片转图",
    width,
    height,
    cells,
    palette,
  });
}
