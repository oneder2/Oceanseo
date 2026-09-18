import { validSize } from "./model";
/** Deterministic area sampling in premultiplied alpha. Browser resize filters
 * differ when shrinking large photos; averaging only a few samples aliases texture. */
export function resampleImage(
  data: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  mode: "photo" | "pixel",
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
        }
      }
      if (alpha > 0) {
        result[out] = r / alpha;
        result[out + 1] = g / alpha;
        result[out + 2] = b / alpha;
        result[out + 3] = (255 * alpha) / area;
      }
    }
  return result;
}
