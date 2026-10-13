import test from "node:test";
import assert from "node:assert/strict";
import { blankPattern } from "../src/beads/model";
import { activeWork, addWork, archiveActiveWork, currentPattern, duplicateWork, findActiveWork, isBeadWorksDocument, migrateLegacyPattern, patternImpact, renameWork, restoreVersion, restoreWork, savePattern } from "../src/beads/works";

test("legacy bead pattern migrates to one active work without changing its cells", () => {
  const pattern = blankPattern(3, 2);
  pattern.cells[0] = 1;
  const works = migrateLegacyPattern(pattern);
  assert.equal(works.works.length, 1);
  assert.equal(currentPattern(activeWork(works)).cells[0], 1);
  assert.ok(isBeadWorksDocument(works));
});

test("work edits create bounded versions and preserve the active version", () => {
  let works = migrateLegacyPattern(blankPattern(2, 2));
  for (let i = 0; i < 25; i++) {
    const pattern = { ...currentPattern(activeWork(works)), cells: [i % 2, -1, -1, -1] };
    works = savePattern(works, pattern, `编辑 ${i}`);
  }
  assert.equal(activeWork(works).versions.length, 20);
  assert.equal(currentPattern(activeWork(works)).cells[0], 0);
  assert.ok(isBeadWorksDocument(works));
});

test("new work and rename do not overwrite the source work", () => {
  let works = migrateLegacyPattern(blankPattern(2, 2));
  const first = activeWork(works).id;
  works = addWork(works, blankPattern(4, 4), "第二件");
  assert.equal(works.works.length, 2);
  assert.equal(activeWork(works).title, "第二件");
  works = renameWork(works, "第二件·修改");
  assert.equal(works.works.find(work => work.id === first)?.title, "我的拼豆图纸");
  assert.equal(activeWork(works).title, "第二件·修改");
});

test("archiving keeps one active work and archived work can be restored", () => {
  let works = migrateLegacyPattern(blankPattern(2, 2));
  works = addWork(works, blankPattern(3, 3), "第二件");
  works = archiveActiveWork(works);
  assert.equal(activeWork(works).title, "我的拼豆图纸");
  const archivedId = works.works.find(work => work.title === "第二件")!.id;
  assert.equal(works.works.find(work => work.id === archivedId)!.archived, true);
  works = restoreWork(works, archivedId);
  assert.equal(activeWork(works).title, "第二件");
  assert.equal(works.works.find(work => work.id === archivedId)!.archived, false);
});

test("restoring a saved version appends a recovery version", () => {
  let works = migrateLegacyPattern(blankPattern(1, 1));
  works = savePattern(works, { ...currentPattern(activeWork(works)), width: 2, cells: [-1, -1] }, "第二版");
  const work = activeWork(works);
  works = restoreVersion(works, work.id, work.versions[0].id);
  assert.equal(currentPattern(activeWork(works)).width, 1);
  assert.equal(activeWork(works).versions.at(-1)?.label, "恢复：初始图纸");
  assert.equal(activeWork(works).versions.length, 3);
  assert.equal(activeWork(works).progressVersionId, activeWork(works).currentVersionId);
});

test("opening an unchanged drawing preserves its version and physical completion marks", () => {
  const works = migrateLegacyPattern({ ...blankPattern(2, 2), cells: [0, -1, -1, -1] });
  const work = activeWork(works);
  work.completedCells = [0];
  const version = work.currentVersionId;
  const reloaded = JSON.parse(JSON.stringify(works));
  const saved = savePattern(reloaded, JSON.parse(JSON.stringify(currentPattern(work))), "编辑图纸");
  assert.equal(saved, reloaded);
  assert.equal(activeWork(saved).currentVersionId, version);
  assert.deepEqual(activeWork(saved).completedCells, [0]);
  assert.equal(activeWork(saved).versions.length, 1);
  const edited = savePattern(saved, { ...currentPattern(work), cells: [0, 0, -1, -1] }, "绘制");
  assert.notEqual(activeWork(edited).currentVersionId, version);
  assert.deepEqual(activeWork(edited).completedCells, []);
});

test("duplicating a work preserves all versions and progress with independent identities", () => {
  let document = migrateLegacyPattern({ ...blankPattern(2, 1), cells: [0, -1] });
  document = savePattern(document, { ...currentPattern(activeWork(document)), cells: [1, -1] }, "改色");
  const original = activeWork(document);
  original.completedCells = [0];
  const sourceSnapshot = structuredClone(original);
  const next = duplicateWork(document, original.id);
  const copy = activeWork(next);
  assert.deepEqual(next.works[0], sourceSnapshot);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.versions.length, original.versions.length);
  assert.deepEqual(currentPattern(copy).cells, currentPattern(original).cells);
  assert.deepEqual(copy.completedCells, [0]);
  assert.equal(copy.progressVersionId, copy.currentVersionId);
  assert.ok(copy.versions.every(version => !original.versions.some(old => old.id === version.id)));
  currentPattern(copy).cells[0] = -1;
  assert.equal(currentPattern(original).cells[0], 1);
});

test("new and duplicated works refuse capacity overflow without losing source records", () => {
  let document = migrateLegacyPattern(blankPattern(1, 1));
  for (let index = 1; index < 100; index++) document = addWork(document, blankPattern(1, 1));
  const source = structuredClone(document);
  assert.throws(() => addWork(document, blankPattern(1, 1)), /100/);
  assert.throws(() => duplicateWork(document, document.activeId), /100/);
  assert.deepEqual(document, source);
});

test("drawing changes retain old physical progress and restore it with the historical version", () => {
  let document = migrateLegacyPattern({ ...blankPattern(2, 1), cells: [0, -1] });
  const original = activeWork(document); original.completedCells = [0];
  const oldId = original.currentVersionId;
  document = savePattern(document, { ...currentPattern(original), cells: [1, -1] }, "改色");
  assert.deepEqual(activeWork(document).completedCells, []);
  assert.deepEqual(activeWork(document).versions.find(version => version.id === oldId)?.completedCells, [0]);
  document = restoreVersion(document, original.id, oldId);
  assert.deepEqual(activeWork(document).completedCells, [0]);
  assert.equal(activeWork(document).progressVersionId, activeWork(document).currentVersionId);
  assert.ok(isBeadWorksDocument(document));
});

test("metadata and palette reorder preserve progress only when the physical layout and material identity match", () => {
  let document = migrateLegacyPattern({ ...blankPattern(2, 1), cells: [0, 1] });
  activeWork(document).completedCells = [0];
  const initial = currentPattern(activeWork(document));
  document = savePattern(document, { ...initial, beadPitchMm: 2.6 }, "豆距");
  assert.deepEqual(activeWork(document).completedCells, [0]);
  const renamed = { ...currentPattern(activeWork(document)), palette: initial.palette.map(color => ({ ...color, name: "新名字" })) };
  document = savePattern(document, renamed, "颜色名称");
  assert.deepEqual(activeWork(document).completedCells, [0]);
  const reordered = { ...renamed, palette: [...renamed.palette].reverse(), cells: renamed.cells.map(color => renamed.palette.length - 1 - color) };
  assert.equal(patternImpact(renamed, reordered).changed, 0);
  document = savePattern(document, reordered, "重排色板");
  assert.deepEqual(activeWork(document).completedCells, [0]);
  const resized = { ...reordered, width: 1, cells: [reordered.cells[0]] };
  assert.deepEqual(patternImpact(reordered, resized), { changed: 1, cropped: 1, progressCompatible: false });
  document = savePattern(document, resized, "裁切");
  assert.deepEqual(activeWork(document).completedCells, []);
});

test("empty and deleted-only libraries are valid without creating placeholder works", () => {
  const empty = { version: 1 as const, activeId: "", works: [] };
  assert.ok(isBeadWorksDocument(empty));
  assert.equal(findActiveWork(empty), undefined);
  assert.equal(savePattern(empty, blankPattern(), "打开"), empty);
  let document = migrateLegacyPattern({ ...blankPattern(1, 1), cells: [0] });
  const work = activeWork(document); work.completedCells = [0]; work.archived = true;
  work.deletedAt = new Date().toISOString(); work.deletedFromArchive = false;
  document.activeId = "";
  assert.ok(isBeadWorksDocument(document));
  assert.equal(findActiveWork(document), undefined);
  assert.throws(() => duplicateWork(document, work.id), /恢复/);
  const next = addWork(document, blankPattern(), "新作品");
  assert.equal(next.works.length, 2);
  assert.deepEqual(next.works[0].completedCells, [0]);
});

test("deleted metadata, purged identity collisions and invalid version progress cannot be loaded", () => {
  const source = migrateLegacyPattern({ ...blankPattern(2, 1), cells: [0, -1] });
  const deleted = structuredClone(source); deleted.works[0].deletedAt = "2026-10-11T00:00:00Z";
  assert.equal(isBeadWorksDocument(deleted), false);
  deleted.works[0].deletedFromArchive = false; deleted.works[0].archived = true; deleted.activeId = "";
  assert.ok(isBeadWorksDocument(deleted));
  deleted.purgedWorkIds = [deleted.works[0].id]; assert.equal(isBeadWorksDocument(deleted), false);
  const bad = structuredClone(source); bad.works[0].versions[0].completedCells = [1];
  assert.equal(isBeadWorksDocument(bad), false);
  bad.works[0].versions[0].completedCells = [0, 0]; assert.equal(isBeadWorksDocument(bad), false);
});
