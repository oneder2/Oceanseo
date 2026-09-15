import test from "node:test";
import assert from "node:assert/strict";
import { blankPattern } from "../src/beads/model";
import {
  createDocument,
  documentReducer,
  HISTORY_LIMIT,
} from "../src/beads/document";
import { fitCamera, resizeCamera, zoomCamera } from "../src/beads/camera";

test("document transactions preserve metadata and undo in exact edit order", () => {
  const original = blankPattern(2, 2);
  let state = createDocument(original);
  state = documentReducer(state, {
    type: "commit",
    label: "画笔",
    after: { ...original, cells: [0, 0, -1, -1] },
  });
  state = documentReducer(state, {
    type: "commit",
    label: "豆距",
    after: { ...state.present, beadPitchMm: 2.6 },
  });
  state = documentReducer(state, {
    type: "commit",
    label: "标题",
    after: { ...state.present, title: "新名称" },
  });
  const finished = state.present;
  state = documentReducer(state, { type: "undo" });
  assert.equal(state.present.title, original.title);
  assert.equal(state.present.beadPitchMm, 2.6);
  state = documentReducer(state, { type: "undo" });
  assert.equal(state.present.beadPitchMm, undefined);
  state = documentReducer(state, { type: "undo" });
  assert.equal(state.present, original);
  for (let i = 0; i < 3; i++) state = documentReducer(state, { type: "redo" });
  assert.equal(state.present, finished);
});
test("no-op strokes preserve redo; new changes replace the redo branch", () => {
  const original = blankPattern(2, 2);
  let state = documentReducer(createDocument(original), {
    type: "commit",
    label: "标题",
    after: { ...original, title: "A" },
  });
  state = documentReducer(state, { type: "undo" });
  const before = state;
  state = documentReducer(state, {
    type: "commit",
    label: "空笔画",
    after: { ...original, cells: [...original.cells], beadPitchMm: 5 },
  });
  assert.equal(state, before);
  assert.equal(state.future.length, 1);
  state = documentReducer(state, {
    type: "commit",
    label: "新分支",
    after: { ...original, title: "B" },
  });
  assert.equal(state.future.length, 0);
  assert.equal(documentReducer(state, { type: "redo" }), state);
});
test("preview freezes baseline; cancel never changes document; apply commits exactly once", () => {
  const original = blankPattern(2, 2);
  const initial = createDocument(original),
    after = { ...original, cells: [0, 0, 0, 0] };
  const preview = documentReducer(initial, {
    type: "propose",
    proposal: { label: "填充", after, message: "确认" },
  });
  assert.equal(preview.present, original);
  assert.equal(preview.past.length, 0);
  assert.equal(documentReducer(preview, { type: "undo" }), preview);
  assert.equal(
    documentReducer(preview, {
      type: "commit",
      label: "并发修改",
      after: { ...original, title: "意外" },
    }),
    preview,
  );
  const cancelled = documentReducer(preview, { type: "discard" });
  assert.equal(cancelled.present, original);
  assert.equal(cancelled.past.length, 0);
  const applied = documentReducer(preview, { type: "apply" });
  assert.equal(applied.present, after);
  assert.equal(applied.past.length, 1);
  assert.equal(documentReducer(applied, { type: "apply" }), applied);
  assert.equal(documentReducer(applied, { type: "undo" }).present, original);
});
test("history is bounded and invalid documents cannot enter the store", () => {
  let state = createDocument(blankPattern());
  for (let i = 1; i <= 30; i++)
    state = documentReducer(state, {
      type: "commit",
      label: "重命名",
      after: { ...state.present, title: String(i) },
    });
  assert.equal(state.past.length, HISTORY_LIMIT);
  assert.equal(
    documentReducer(state, {
      type: "commit",
      label: "无效",
      after: { ...state.present, cells: [999] },
    }),
    state,
  );
  for (let i = 0; i < HISTORY_LIMIT; i++)
    state = documentReducer(state, { type: "undo" });
  assert.equal(state.present.title, "10");
  assert.equal(state.future.length, HISTORY_LIMIT);
});
test("opening inspector preserves zoom and the grid point at viewport center", () => {
  const before = { width: 1000, height: 600 },
    after = { width: 712, height: 600 };
  const camera = { cell: 48, x: -123, y: -76 };
  const next = resizeCamera(camera, before, after);
  assert.equal(next.cell, 48);
  assert.equal(
    (before.width / 2 - camera.x) / camera.cell,
    (after.width / 2 - next.x) / next.cell,
  );
  assert.deepEqual(resizeCamera(next, after, before), camera);
});
test("zoom keeps the pointer grid point fixed and fit leaves coordinate margins", () => {
  const initial = { cell: 20, x: 40, y: 30 };
  const next = zoomCamera(initial, 1.4, 260, 170);
  assert.equal((260 - initial.x) / initial.cell, (260 - next.x) / next.cell);
  assert.equal((170 - initial.y) / initial.cell, (170 - next.y) / next.cell);
  assert.equal(zoomCamera(initial, 1000, 0, 0).cell, 72);
  assert.equal(zoomCamera(initial, 0.001, 0, 0).cell, 1);
  const fitted = fitCamera(160, 160, { width: 900, height: 600 });
  assert.ok(fitted.x >= 44 && fitted.y >= 38);
  assert.ok(fitted.x + 160 * fitted.cell <= 900 - 40);
  assert.ok(fitted.y + 160 * fitted.cell <= 600 - 38);
});
