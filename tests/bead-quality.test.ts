import test from "node:test";
import assert from "node:assert/strict";
import { convertImage } from "../src/beads/convert";
import { resampleImage } from "../src/beads/resample";
import { colorDistance } from "../src/beads/colorDistance";

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
