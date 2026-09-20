import test from "node:test";
import "./bead-document.test";
import "./life.test";
import "./goals.test";
import "./goal-handoff.test";
import assert from "node:assert/strict";
import { convertImage, type ConvertOptions } from "../src/beads/convert";
import {
  blankPattern,
  counts,
  isPattern,
  resizePattern,
  ink,
  physicalSize,
} from "../src/beads/model";
import { fillHoles, floodFill, thickenOutline } from "../src/beads/edit";
import { dateFromKey, dateKey } from "../src/dateUtils";

test("calendar dates preserve leap years and centuries during year jumps", () => {
  for (const key of [
    "0100-01-01",
    "1900-03-01",
    "2000-02-29",
    "2032-02-29",
    "9999-12-31",
  ])
    assert.equal(dateKey(dateFromKey(key)), key);
  assert.notEqual(dateKey(dateFromKey("1900-02-29")), "1900-02-29");
});

function raster(
  w: number,
  h: number,
  pixel: (x: number, y: number) => number[],
) {
  return new Uint8ClampedArray(
    Array.from({ length: w * h }, (_, i) =>
      pixel(i % w, Math.floor(i / w)),
    ).flat(),
  );
}
const opts: ConvertOptions = {
  width: 5,
  height: 5,
  colors: 8,
  cleanup: 1,
  mode: "photo",
};
test("pixel mode preserves exact source colors, holes and isolated outline details", () => {
  const data = raster(5, 5, (x, y) =>
    x === 2 && y === 2
      ? [0, 0, 0, 255]
      : x === 0
        ? [20, 30, 40, 0]
        : [253, 12, 19, 255],
  );
  const p = convertImage(data, { ...opts, mode: "pixel" });
  assert.equal(p.cells[0], -1);
  assert.equal(p.palette[p.cells[12]].hex, "#000000");
  assert.equal(p.palette[p.cells[1]].hex, "#fd0c13");
  assert.equal(
    counts(p).reduce((a, b) => a + b),
    20,
  );
  assert.ok(isPattern(p));
});
test("photo conversion is deterministic, capped, and keeps strong small features", () => {
  const data = raster(32, 32, (x, y) =>
    x === 16 && y === 16
      ? [0, 0, 0, 255]
      : [220 + (x % 30), 200 + (y % 30), 180, 255],
  );
  const o = { ...opts, width: 32, height: 32, colors: 6, cleanup: 2 };
  const a = convertImage(data, o),
    b = convertImage(data, o);
  assert.deepEqual(a, b);
  assert.ok(a.palette.length <= 6);
  assert.ok(isPattern(a));
  assert.notEqual(a.cells[16 * 32 + 16], a.cells[16 * 32 + 15]);
});
test("transparent images produce zero beads and valid documents in both modes", () => {
  for (const mode of ["photo", "pixel"] as const) {
    const p = convertImage(new Uint8ClampedArray(100), { ...opts, mode });
    assert.ok(isPattern(p));
    assert.ok(p.cells.every((c) => c === -1));
  }
});
test("pixel mode refuses over 256 colors instead of silently destroying the palette", () => {
  const data = raster(20, 20, (x, y) => [x, y, 0, 255]);
  assert.throws(
    () => convertImage(data, { ...opts, width: 20, height: 20, mode: "pixel" }),
    /256/,
  );
});
test("resizing crops or pads without stretching unless explicitly requested", () => {
  const p = { ...blankPattern(2, 2), cells: [0, 1, 2, -1] };
  assert.deepEqual(
    resizePattern(p, 3, 3, false).cells,
    [0, 1, -1, 2, -1, -1, -1, -1, -1],
  );
  assert.deepEqual(resizePattern(p, 1, 2, false).cells, [0, 2]);
  assert.deepEqual(
    resizePattern(p, 4, 2, true).cells,
    [0, 0, 1, 1, 2, 2, -1, -1],
  );
  assert.throws(() => resizePattern(p, 161, 1, false));
});
test("document validation rejects corrupt indices, dimensions and colors", () => {
  assert.equal(isPattern({ ...blankPattern(), cells: [999] }), false);
  assert.equal(isPattern({ ...blankPattern(), width: Infinity }), false);
  assert.equal(
    isPattern({ ...blankPattern(), palette: [{ hex: "red", name: "red" }] }),
    false,
  );
  assert.equal(ink("#000000"), "#ffffff");
  assert.equal(ink("#ffffff"), "#172127");
});
test("maximum conversion stays within declared bounds", () => {
  const p = convertImage(
    raster(160, 160, (x, y) => [x, y, (x * y) % 256, 255]),
    { ...opts, width: 160, height: 160, colors: 48 },
  );
  assert.ok(isPattern(p));
  assert.ok(p.palette.length <= 48);
  assert.equal(p.cells.length, 25600);
});

function ring() {
  const p = blankPattern(7, 7);
  for (let y = 1; y <= 5; y++)
    for (let x = 1; x <= 5; x++)
      if (x === 1 || x === 5 || y === 1 || y === 5) p.cells[y * 7 + x] = 0;
  return p;
}
test("hole filling preserves outside background and existing bead colors", () => {
  const p = ring(),
    before = [...p.cells];
  const filled = fillHoles(p, 2);
  assert.equal(counts(filled)[2], 9);
  assert.equal(counts(filled)[0], 16);
  assert.equal(filled.cells[0], -1);
  assert.deepEqual(p.cells, before);
  const open = ring();
  open.cells[1 * 7 + 3] = -1;
  assert.equal(fillHoles(open, 2), open);
  assert.equal(
    fillHoles(blankPattern(), 0).cells.filter((c) => c >= 0).length,
    0,
  );
});
test("region fill affects only the clicked four-connected component", () => {
  const p = { ...blankPattern(3, 3), cells: [0, 1, 0, 1, 0, 1, 0, 1, -1] };
  const next = floodFill(p, 1, 1, 2);
  assert.deepEqual(next.cells, [0, 1, 0, 1, 2, 1, 0, 1, -1]);
  assert.equal(floodFill(p, 0, 0, 0), p);
  assert.equal(floodFill(p, -1, 0, 1), p);
  assert.throws(() => floodFill(p, 0, 0, 99));
  assert.equal(counts(floodFill(ring(), 3, 3, 2))[2], 9);
});
test("outline grows outward while preserving holes and the source", () => {
  const p = ring(),
    next = thickenOutline(p, 2, 1, true);
  assert.equal(next.width, 7);
  assert.equal(next.height, 7);
  assert.equal(counts(next)[2], 24);
  assert.equal(counts(next)[0], 16);
  assert.equal(next.cells[3 * 7 + 3], -1);
  assert.equal(counts(p)[2], 0);
  const larger = thickenOutline(p, 2, 2, true);
  assert.equal(larger.width, 9);
  assert.equal(larger.height, 9);
  assert.equal(counts(larger)[2], 56);
  assert.equal(larger.cells[4 * 9 + 4], -1);
});
test("outline expands at canvas edges or clips only when expansion is disabled", () => {
  const p = { ...blankPattern(1, 1), cells: [0], beadPitchMm: 2.6 };
  const next = thickenOutline(p, 1, 2, true);
  assert.equal(next.width, 5);
  assert.equal(next.height, 5);
  assert.equal(next.cells[12], 0);
  assert.equal(counts(next)[1], 24);
  assert.equal(next.beadPitchMm, 2.6);
  assert.equal(thickenOutline(p, 1, 2, false), p);
  assert.equal(
    thickenOutline(blankPattern(), 0, 1, true).cells.filter((c) => c >= 0)
      .length,
    0,
  );
  const huge = blankPattern(160, 160);
  huge.cells.fill(0);
  assert.throws(() => thickenOutline(huge, 1, 1, true), /160/);
  assert.equal(thickenOutline(huge, 1, 1, false), huge);
  assert.throws(() => thickenOutline(p, 1, 0, true), /1–8/);
  assert.equal(huge.cells.length, 25600);
});
test("physical dimensions distinguish occupied artwork from transparent margins", () => {
  const p = ring();
  assert.deepEqual(physicalSize(p), {
    pitch: 5,
    canvas: { width: 3.5, height: 3.5 },
    artwork: { width: 2.5, height: 2.5 },
  });
  const mini = { ...p, beadPitchMm: 2.6 };
  assert.equal(physicalSize(mini).artwork?.width, 1.3);
  assert.equal(physicalSize(blankPattern()).artwork, null);
  assert.equal(isPattern(mini), true);
  for (const beadPitchMm of [0, -1, NaN, Infinity, 21])
    assert.equal(isPattern({ ...p, beadPitchMm }), false);
  assert.equal(isPattern(JSON.parse(JSON.stringify(mini))), true);
  assert.equal(resizePattern(mini, 8, 8, false).beadPitchMm, 2.6);
});
import "./reliability.test";
import "./bead-quality.test";
import "./assistant.test";
