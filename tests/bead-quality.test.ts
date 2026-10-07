import test from "node:test";
import assert from "node:assert/strict";
import { convertImage } from "../src/beads/convert";
import { resampleImage } from "../src/beads/resample";
import { colorDistance } from "../src/beads/colorDistance";
import { boundaryScene, diagonalScene } from "./fixtures/bead-boundaries";
import { cleanBoundaryRegions } from "../src/beads/boundaryCleanup";

test("final cleanup removes two- and three-colour junction ribbons across custom and real-brand palettes", () => {
  const fixture = boundaryScene();
  for (const brand of ["custom", "MARD", "COCO"] as const) {
    const result = convertImage(fixture.data, {
      width: 64,
      height: 64,
      colors: 24,
      cleanup: 2,
      mode: "photo",
      brand,
    });
    const body = new Set([
      result.cells[10 * 64 + 20],
      result.cells[10 * 64 + 45],
      result.cells[45 * 64 + 45],
    ]);
    assert.equal(
      fixture.seams.filter((i) => !body.has(result.cells[i])).length,
      0,
      `${brand}: remaining mixed boundary beads`,
    );
    const black = result.cells[10 * 64 + 12];
    assert.ok(!body.has(black));
    for (let y = 5; y < 60; y++) assert.equal(result.cells[y * 64 + 12], black);
    assert.ok(!body.has(result.cells[16 * 64 + 44]), "highlight must survive");
    assert.ok(result.palette.length <= 24);
  }
});

test("edge-supported sampling does not invent colours at multi-region diagonals", () => {
  const f = diagonalScene();
  const averaged = resampleImage(f.data, f.width, f.height, 48, 48, "photo");
  const supported = resampleImage(
    f.data,
    f.width,
    f.height,
    48,
    48,
    "photo",
    true,
  );
  const foreign = (data: Uint8ClampedArray) =>
    Array.from({ length: 48 * 48 }, (_, i) => i).filter(
      (i) =>
        !f.colors.some((c) =>
          c.every((v, k) => Math.abs(data[i * 4 + k] - v) <= 1),
        ),
    ).length;
  assert.ok(
    foreign(averaged) > 50,
    "fixture must expose the old area-average fringe",
  );
  assert.equal(foreign(supported), 0);
  assert.deepEqual(
    supported,
    resampleImage(f.data, f.width, f.height, 48, 48, "photo", true),
  );
});

test("boundary cleanup leaves transparency, solid colour islands and contrast extrema intact", () => {
  const cells = Array.from({ length: 81 }, (_, i) => (i % 9 === 0 ? -1 : 0));
  for (let y = 3; y <= 5; y++)
    for (let x = 3; x <= 5; x++) cells[y * 9 + x] = 1;
  cells[11] = 2;
  cells[16] = 3;
  const colors = [
    [140, 140, 140],
    [140, 80, 170],
    [0, 0, 0],
    [255, 255, 255],
  ];
  const pixels = cells.map((i) => (i < 0 ? null : colors[i]));
  assert.deepEqual(cleanBoundaryRegions(cells, pixels, 9, 9, 2), cells);
  assert.deepEqual(cleanBoundaryRegions(cells, pixels, 9, 9, 0), cells);
});

test("boundary cleanup does not split an ambiguous thin region into new isolated remnants", () => {
  const w = 11,
    h = 11,
    cells: number[] = [],
    pixels: number[][] = [];
  const a = [192, 76, 60],
    b = [64, 120, 176],
    mix = a.map((v, i) => (v + b[i]) / 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      cells.push(x < 5 ? 0 : x > 5 ? 1 : 2);
      pixels.push(x < 5 ? a : x > 5 ? b : y === 5 ? [245, 245, 245] : mix);
    }
  assert.deepEqual(cleanBoundaryRegions(cells, pixels, w, h, 2), cells);
});

test("CIEDE2000 agrees with published Sharma reference pairs, including zero chroma", () => {
  const pairs = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, 0, 0], [50, -1, 2], 2.3669],
  ] as const;
  for (const [a, b, expected] of pairs) {
    assert.ok(
      Math.abs(Math.sqrt(colorDistance([...a], [...b])) - expected) < 0.0001,
    );
    assert.ok(
      Math.abs(colorDistance([...a], [...b]) - colorDistance([...b], [...a])) <
        1e-8,
    );
  }
});
import {
  BRANDS,
  brandPalette,
  CATALOG_ID,
  editColor,
  mapPatternToBrand,
} from "../src/beads/palettes";
import { blankPattern, colorCode, counts, isPattern } from "../src/beads/model";
import { createDocument, documentReducer } from "../src/beads/document";

const opts = {
  width: 48,
  height: 48,
  colors: 16,
  cleanup: 2,
  mode: "photo" as const,
};
function scene(noisy: boolean) {
  const pixels = new Uint8ClampedArray(48 * 48 * 4);
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 48; x++) {
      let rgb =
        x < 24 ? [155, 155, 155] : y < 24 ? [195, 175, 145] : [105, 140, 155];
      if (x === 12 || (y === 12 && x > 4 && x < 20)) rgb = [10, 10, 10];
      if (x === 32 && y === 32) rgb = [255, 255, 255];
      if (
        noisy &&
        x !== 12 &&
        x > 2 &&
        x < 21 &&
        x % 8 === 4 &&
        y > 15 &&
        y % 8 === 4
      )
        rgb = [220, 70, 170];
      if (noisy && y === 35 && (x === 6 || x === 7)) rgb = [220, 70, 170];
      pixels.set([...rgb, 255], (y * 48 + x) * 4);
    }
  return pixels;
}
test("strong cleanup removes chromatic impulses and paired flecks while preserving thin dark lines and highlights", () => {
  const clean = convertImage(scene(false), opts),
    result = convertImage(scene(true), opts);
  const hexAt = (p: typeof result, i: number) => p.palette[p.cells[i]].hex;
  for (const i of [20 * 48 + 4, 28 * 48 + 20, 35 * 48 + 6, 35 * 48 + 7])
    assert.equal(hexAt(result, i), hexAt(clean, i));
  for (let y = 0; y < 48; y++)
    assert.equal(hexAt(result, y * 48 + 12), "#0a0a0a");
  assert.ok(
    [1, 3, 5].every(
      (i) => parseInt(hexAt(result, 32 * 48 + 32).slice(i, i + 2), 16) >= 245,
    ),
  );
  assert.ok(counts(result).every((n) => n > 0));
  assert.deepEqual(result, convertImage(scene(true), opts));
});
test("brand catalogs have real unique codes; conversion and remapping stay within the selected catalog", () => {
  for (const brand of BRANDS) {
    const catalog = brandPalette(brand);
    assert.equal(catalog.length, 221);
    assert.equal(new Set(catalog.map((c) => c.code)).size, 221);
    const p = convertImage(scene(true), { ...opts, brand });
    assert.ok(isPattern(p));
    assert.ok(p.palette.length <= opts.colors);
    assert.ok(
      p.palette.every((c) =>
        catalog.some((v) => c.code === v.code && c.hex === v.hex),
      ),
    );
    assert.equal(p.palette[0].brand, brand);
    assert.equal(colorCode(0, p), p.palette[0].code);
    const restored = JSON.parse(JSON.stringify(p));
    assert.ok(isPattern(restored));
    restored.palette[0].code = "invented";
    assert.equal(isPattern(restored), false);
  }
  assert.equal(
    brandPalette("MARD").find((c) => c.code === "A01")?.hex,
    "#faf4c8",
  );
  assert.equal(
    brandPalette("MARD").find((c) => c.code === "H07")?.hex,
    "#000000",
  );
});
test("manufacturer identity participates in history, survives names, and detaches when RGB changes", () => {
  const p = {
    ...blankPattern(1, 1),
    palette: [{ hex: "#faf4c8", name: "MARD" }],
    cells: [0],
  };
  const after = mapPatternToBrand(p, "MARD");
  const changed = documentReducer(createDocument(p), {
    type: "commit",
    label: "品牌",
    after,
  });
  assert.equal(changed.past.length, 1);
  assert.deepEqual(documentReducer(changed, { type: "undo" }).present, p);
  assert.equal(editColor(after.palette[0], "name", "奶黄").catalog, CATALOG_ID);
  const custom = editColor(after.palette[0], "hex", "#000001");
  assert.equal(custom.code, undefined);
  assert.equal(custom.brand, undefined);
  assert.equal(
    colorCode(1, { ...after, palette: [...after.palette, custom] }),
    "U02",
  );
  assert.ok(isPattern(p));
});
test("area sampling averages high frequency texture without hidden transparent RGB bleeding", () => {
  const checker = new Uint8ClampedArray(
    Array.from({ length: 64 }, (_, i) => [
      (i + Math.floor(i / 8)) % 2 ? 255 : 0,
      0,
      0,
      255,
    ]).flat(),
  );
  assert.deepEqual(
    [...resampleImage(checker, 8, 8, 1, 1, "photo")],
    [128, 0, 0, 255],
  );
  assert.deepEqual(
    [...resampleImage(checker, 8, 8, 1, 1, "photo", true)],
    [128, 0, 0, 255],
  );
  const alpha = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0,
  ]);
  assert.deepEqual(
    [...resampleImage(alpha, 2, 2, 1, 1, "photo")],
    [255, 0, 0, 128],
  );
  assert.deepEqual(resampleImage(alpha, 2, 2, 2, 2, "pixel"), alpha);
  const letterbox = resampleImage(
    new Uint8ClampedArray([12, 34, 56, 255, 12, 34, 56, 255]),
    2,
    1,
    4,
    4,
    "photo",
  );
  assert.equal(letterbox[3], 0);
  assert.equal(letterbox[19], 255);
  assert.equal(letterbox[63], 0);
});
