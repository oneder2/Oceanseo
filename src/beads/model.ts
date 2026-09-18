import { validColorIdentity, type BeadBrand } from "./palettes";
export interface BeadColor {
  hex: string;
  name: string;
  brand?: BeadBrand;
  code?: string;
  catalog?: string;
}
export interface BeadPattern {
  version: 1;
  title: string;
  width: number;
  height: number;
  palette: BeadColor[];
  cells: number[];
  /** Nominal peg/bead spacing in millimetres; older documents default to 5 mm. */
  beadPitchMm?: number;
}
export const MAX_SIZE = 160;
export const MAX_COLORS = 256;
export function blankPattern(width = 29, height = 29): BeadPattern {
  return {
    version: 1,
    title: "我的拼豆图纸",
    width,
    height,
    palette: [
      "#263b46",
      "#f6eee1",
      "#ed8467",
      "#e8bd53",
      "#769f91",
      "#709dbc",
    ].map((hex, i) => ({ hex, name: `颜色 ${i + 1}` })),
    cells: Array(width * height).fill(-1),
  };
}
export function validSize(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_SIZE;
}
export function isPattern(value: unknown): value is BeadPattern {
  if (!value || typeof value !== "object") return false;
  const p = value as BeadPattern;
  return (
    p.version === 1 &&
    typeof p.title === "string" &&
    p.title.length <= 80 &&
    validSize(p.width) &&
    validSize(p.height) &&
    (p.beadPitchMm === undefined || validPitch(p.beadPitchMm)) &&
    Array.isArray(p.palette) &&
    p.palette.length > 0 &&
    p.palette.length <= MAX_COLORS &&
    p.palette.every(
      (c) =>
        c &&
        /^#[0-9a-f]{6}$/i.test(c.hex) &&
        typeof c.name === "string" &&
        c.name.length <= 40 &&
        validColorIdentity(c),
    ) &&
    Array.isArray(p.cells) &&
    p.cells.length === p.width * p.height &&
    p.cells.every((c) => Number.isInteger(c) && c >= -1 && c < p.palette.length)
  );
}
export function resizePattern(
  p: BeadPattern,
  width: number,
  height: number,
  scale: boolean,
): BeadPattern {
  if (!validSize(width) || !validSize(height))
    throw new Error("尺寸需要在 1–160 格之间");
  const cells = Array.from({ length: width * height }, (_, i) => {
    const x = i % width,
      y = Math.floor(i / width);
    const sx = scale ? Math.floor((x * p.width) / width) : x;
    const sy = scale ? Math.floor((y * p.height) / height) : y;
    return sx < p.width && sy < p.height ? p.cells[sy * p.width + sx] : -1;
  });
  return { ...p, width, height, cells };
}
export function colorCode(index: number, pattern?: BeadPattern) {
  const color = pattern?.palette[index];
  if (
    color?.brand &&
    pattern?.palette.some((c) => c.brand && c.brand !== color.brand)
  )
    return `${color.brand}:${color.code}`;
  return (
    pattern?.palette[index]?.code ??
    `${pattern?.palette.some((c) => c.brand) ? "U" : "B"}${String(index + 1).padStart(2, "0")}`
  );
}
export function counts(p: BeadPattern) {
  const values = p.palette.map(() => 0);
  p.cells.forEach((c) => {
    if (c >= 0) values[c]++;
  });
  return values;
}
export function ink(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179
    ? "#172127"
    : "#ffffff";
}

export function validPitch(value: number) {
  return Number.isFinite(value) && value >= 0.5 && value <= 20;
}
export function occupiedBounds(p: BeadPattern) {
  let left = p.width,
    top = p.height,
    right = -1,
    bottom = -1;
  p.cells.forEach((c, i) => {
    if (c < 0) return;
    const x = i % p.width,
      y = Math.floor(i / p.width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  });
  return right < 0 ? null : { left, top, right, bottom };
}
export function physicalSize(p: BeadPattern) {
  const pitch = p.beadPitchMm ?? 5;
  const bounds = occupiedBounds(p);
  return {
    pitch,
    canvas: { width: (p.width * pitch) / 10, height: (p.height * pitch) / 10 },
    artwork: bounds
      ? {
          width: ((bounds.right - bounds.left + 1) * pitch) / 10,
          height: ((bounds.bottom - bounds.top + 1) * pitch) / 10,
        }
      : null,
  };
}
export function formatCm(value: number) {
  return Number(value.toFixed(2)).toString();
}
