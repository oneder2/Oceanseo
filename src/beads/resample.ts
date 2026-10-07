import { validSize } from "./model";
/** Mode sampling suits flat artwork. Applying it to continuous-tone photos
 * over-emphasizes texture and changes the clustering palette (e.g. dark sky
 * scaffolding). Use bounded global evidence before enabling edge snapping. */
function hasFlatPalette(data: Uint8ClampedArray) {
  const bins = new Map<number, number>();
  const stride = Math.max(1, Math.ceil(data.length / 4 / 65536));
  let total = 0;
  for (let i = 0; i < data.length; i += stride * 4) {
    if (data[i + 3] < 128) continue;
    const key =
      (data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3);
    bins.set(key, (bins.get(key) ?? 0) + 1);
    total++;
  }
  return (
    total > 0 &&
    [...bins.values()]
      .sort((a, b) => b - a)
      .slice(0, 16)
      .reduce((a, b) => a + b, 0) >=
      total * 0.9
  );
}
/** Deterministic area sampling in premultiplied alpha. Browser resize filters
 * differ when shrinking large photos; averaging only a few samples aliases texture. */
export function resampleImage(
  data: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  mode: "photo" | "pixel",
  preserveEdges = false,
) {
  if (
    !Number.isInteger(sourceWidth) ||
    !Number.isInteger(sourceHeight) ||
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    sourceWidth * sourceHeight > 16_000_000 ||
    data.length !== sourceWidth * sourceHeight * 4 ||
    !validSize(width) ||
    !validSize(height)
  )
    throw Error("图片采样尺寸无效");
  const result = new Uint8ClampedArray(width * height * 4);
  const edgeSampling =
    preserveEdges && mode === "photo" && hasFlatPalette(data);
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const ox = (width - sourceWidth * scale) / 2,
    oy = (height - sourceHeight * scale) / 2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      if (mode === "pixel") {
        const sx = Math.floor((x + 0.5 - ox) / scale),
          sy = Math.floor((y + 0.5 - oy) / scale);
        if (sx >= 0 && sx < sourceWidth && sy >= 0 && sy < sourceHeight)
          result.set(
            data.subarray(
              (sy * sourceWidth + sx) * 4,
              (sy * sourceWidth + sx) * 4 + 4,
            ),
            out,
          );
        continue;
      }
      const left = (x - ox) / scale,
        right = (x + 1 - ox) / scale,
        top = (y - oy) / scale,
        bottom = (y + 1 - oy) / scale;
      const area = (right - left) * (bottom - top);
      let alpha = 0,
        r = 0,
        g = 0,
        b = 0;
      const bins = edgeSampling
        ? new Map<
            number,
            { weight: number; rgb: number[]; x: number; y: number }
          >()
        : null;
      for (
        let sy = Math.max(0, Math.floor(top));
        sy < Math.min(sourceHeight, Math.ceil(bottom));
        sy++
      ) {
        const wy = Math.min(bottom, sy + 1) - Math.max(top, sy);
        for (
          let sx = Math.max(0, Math.floor(left));
          sx < Math.min(sourceWidth, Math.ceil(right));
          sx++
        ) {
          const i = (sy * sourceWidth + sx) * 4;
          const weight =
            ((Math.min(right, sx + 1) - Math.max(left, sx)) *
              wy *
              data[i + 3]) /
            255;
          alpha += weight;
          r += data[i] * weight;
          g += data[i + 1] * weight;
          b += data[i + 2] * weight;
          if (bins && weight > 0) {
            const key =
              (data[i] >> 4) * 256 +
              (data[i + 1] >> 4) * 16 +
              (data[i + 2] >> 4);
            const bin = bins.get(key) ?? {
              weight: 0,
              rgb: [0, 0, 0],
              x: 0,
              y: 0,
            };
            bin.weight += weight;
            bin.x += sx * weight;
            bin.y += sy * weight;
            for (let c = 0; c < 3; c++) bin.rgb[c] += data[i + c] * weight;
            bins.set(key, bin);
          }
        }
      }
      if (alpha > 0) {
        result[out] = r / alpha;
        result[out + 1] = g / alpha;
        result[out + 2] = b / alpha;
        result[out + 3] = (255 * alpha) / area;
        if (bins && bins.size > 1) {
          const ranked = [...bins.values()].sort((a, b) => b.weight - a.weight);
          const dominant = ranked[0],
            anchor = dominant.rgb.map((v) => v / dominant.weight);
          const cluster = ranked.filter(
            (bin) =>
              bin.rgb.reduce(
                (n, v, c) => n + (v / bin.weight - anchor[c]) ** 2,
                0,
              ) < 1600,
          );
          const support = cluster.reduce((n, bin) => n + bin.weight, 0);
          const strongOther = ranked.some(
            (bin) =>
              bin.weight > alpha * 0.005 &&
              bin.rgb.reduce(
                (n, v, c) => n + (v / bin.weight - anchor[c]) ** 2,
                0,
              ) > 3600 &&
              Math.hypot(
                bin.x / bin.weight - dominant.x / dominant.weight,
                bin.y / bin.weight - dominant.y / dominant.weight,
              ) >
                Math.max(right - left, bottom - top) * 0.1,
          );
          // Keep normal area averaging in smooth/texture-only regions. At a
          // multi-colour boundary choose a supported source mode, not a new hue.
          if (support >= alpha * 0.24 && strongOther)
            for (let c = 0; c < 3; c++)
              result[out + c] =
                cluster.reduce((n, bin) => n + bin.rgb[c], 0) / support;
        }
      }
    }
  return result;
}
