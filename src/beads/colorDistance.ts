/** Squared CIEDE2000 (kL = kC = kH = 1). Accounts for hue/chroma interactions
 * that plain Euclidean Lab misses, especially in dark, low-chroma colors. */
export function colorDistance(a: number[], b: number[]) {
  const rad = Math.PI / 180,
    pow25 = 25 ** 7;
  const c1 = Math.hypot(a[1], a[2]),
    c2 = Math.hypot(b[1], b[2]);
  const meanC7 = ((c1 + c2) / 2) ** 7;
  const g = 0.5 * (1 - Math.sqrt(meanC7 / (meanC7 + pow25)));
  const a1 = (1 + g) * a[1],
    a2 = (1 + g) * b[1];
  const cp1 = Math.hypot(a1, a[2]),
    cp2 = Math.hypot(a2, b[2]);
  const hue = (x: number, y: number) => (Math.atan2(y, x) / rad + 360) % 360;
  const h1 = cp1 === 0 ? 0 : hue(a1, a[2]),
    h2 = cp2 === 0 ? 0 : hue(a2, b[2]);
  const dl = b[0] - a[0],
    dc = cp2 - cp1;
  let dh = h2 - h1;
  if (cp1 * cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh * rad) / 2);
  const l = (a[0] + b[0]) / 2,
    c = (cp1 + cp2) / 2;
  let h = h1 + h2;
  if (cp1 * cp2 !== 0)
    h =
      Math.abs(h1 - h2) <= 180
        ? h / 2
        : h < 360
          ? (h + 360) / 2
          : (h - 360) / 2;
  const t =
    1 -
    0.17 * Math.cos((h - 30) * rad) +
    0.24 * Math.cos(2 * h * rad) +
    0.32 * Math.cos((3 * h + 6) * rad) -
    0.2 * Math.cos((4 * h - 63) * rad);
  const sl = 1 + (0.015 * (l - 50) ** 2) / Math.sqrt(20 + (l - 50) ** 2);
  const sc = 1 + 0.045 * c,
    sh = 1 + 0.015 * c * t;
  const rt =
    -2 *
    Math.sqrt(c ** 7 / (c ** 7 + pow25)) *
    Math.sin(60 * Math.exp(-(((h - 275) / 25) ** 2)) * rad);
  const vl = dl / sl,
    vc = dc / sc,
    vh = dH / sh;
  return vl * vl + vc * vc + vh * vh + rt * vc * vh;
}
