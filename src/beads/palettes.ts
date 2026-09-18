import data from "./palettes/catalog.json";
import { lab } from "./denoise";
import { colorDistance } from "./colorDistance";
import type { BeadColor, BeadPattern } from "./model";

export const CATALOG_ID = "zippland-2519daf-regular";
export const BRANDS = ["MARD", "COCO", "漫漫", "盼盼", "咪小窝"] as const;
export type BeadBrand = (typeof BRANDS)[number];
export const PALETTE_SOURCE =
  "https://github.com/Zippland/perler-beads/blob/2519daf1628534e414bc7a10f0472dc32000bde4/src/app/colorSystemMapping.json";
export const PALETTE_NOTICE =
  "社区整理色表 · 屏幕近似色 · 普通色 221 色；购买时请核对品牌实物色卡。";
// Exclude translucent, pearlescent and fluorescent series: a flat RGB cannot
// model their appearance. Never infer equivalence between brands from a code.
const regular = Object.entries(data).filter(([, row]) =>
  /^[A-HM]\d+$/.test(row.MARD),
);
export function isBrand(value: unknown): value is BeadBrand {
  return BRANDS.includes(value as BeadBrand);
}
export function brandPalette(brand: BeadBrand): BeadColor[] {
  return regular.map(([hex, row]) => ({
    hex: hex.toLowerCase(),
    name: brand,
    brand,
    code: row[brand],
    catalog: CATALOG_ID,
  }));
}
export function validColorIdentity(color: BeadColor) {
  if (
    color.brand === undefined &&
    color.code === undefined &&
    color.catalog === undefined
  )
    return true;
  return (
    isBrand(color.brand) &&
    color.catalog === CATALOG_ID &&
    regular.some(
      ([hex, row]) =>
        hex.toLowerCase() === color.hex.toLowerCase() &&
        row[color.brand!] === color.code,
    )
  );
}
export function rgbOf(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
export function matchPalette(colors: BeadColor[], brand: BeadBrand) {
  const catalog = brandPalette(brand),
    labs = catalog.map((c) => lab(rgbOf(c.hex)));
  return colors.map((c) => {
    const value = lab(rgbOf(c.hex));
    let best = 0;
    for (let i = 1; i < labs.length; i++)
      if (colorDistance(value, labs[i]) < colorDistance(value, labs[best]))
        best = i;
    return catalog[best];
  });
}
export function compactPalette(p: BeadPattern): BeadPattern {
  const used = new Set(p.cells.filter((c) => c >= 0));
  const palette: BeadColor[] = [],
    remap = new Map<number, number>();
  p.palette.forEach((c, i) => {
    if (!used.has(i)) return;
    let index = palette.findIndex(
      (v) => v.hex === c.hex && v.brand === c.brand && v.code === c.code,
    );
    if (index < 0) {
      index = palette.length;
      palette.push(c);
    }
    remap.set(i, index);
  });
  return {
    ...p,
    palette: palette.length ? palette : [p.palette[0]],
    cells: p.cells.map((c) => (c < 0 ? -1 : remap.get(c)!)),
  };
}
export function mapPatternToBrand(
  p: BeadPattern,
  brand: BeadBrand,
): BeadPattern {
  return compactPalette({ ...p, palette: matchPalette(p.palette, brand) });
}
export function editColor(
  color: BeadColor,
  key: "name" | "hex",
  value: string,
): BeadColor {
  if (key === "hex" && value.toLowerCase() !== color.hex.toLowerCase())
    return { hex: value, name: "自定义颜色" };
  return { ...color, [key]: value };
}
export function paletteDescription(p: BeadPattern) {
  const brands = [
    ...new Set(p.palette.flatMap((c) => (c.brand ? [c.brand] : []))),
  ];
  return brands.length
    ? `${brands.join(" / ")} 厂家色号${p.palette.some((c) => !c.brand) ? " + 自定义编号" : ""}`
    : "自定义配色 · B 编号仅用于本图纸";
}
