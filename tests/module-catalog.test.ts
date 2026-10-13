import test from "node:test";
import assert from "node:assert/strict";
import type { View } from "../src/types";
import { moduleCatalog, moduleForView, registeredNavigation, viewSupportsPlatform } from "../src/modules/catalog";

test("module inventory keeps task filters together and every route reachable once", () => {
  const groups = registeredNavigation();
  const routes = groups.flatMap(group => group.items.map(item => item.view));
  assert.equal(routes.length, 15);
  assert.equal(new Set(routes).size, routes.length);
  assert.deepEqual(new Set(routes.map(view => moduleForView(view))), new Set(Object.keys(moduleCatalog)));
  for (const view of ["today", "all", "completed"] as const) assert.equal(moduleForView(view), "tasks");
  assert.deepEqual(groups.map(group => group.items.map(item => item.view)), [
    ["overview", "goals", "calendar", "countdowns", "people"],
    ["today", "all", "completed"],
    ["infrastructure", "work-monitor", "bead-studio"],
    ["meal-planner", "shopping-list", "fitness", "travel"],
  ]);
});

test("module platform policy retains desktop tools and rejects unknown saved routes", () => {
  const routes = registeredNavigation().flatMap(group => group.items.map(item => item.view));
  for (const platform of ["browser", "linux", "windows", "macos", "android", "ios"] as const) {
    for (const view of routes) {
      const unavailable = (platform === "android" && view === "work-monitor") || (platform === "ios" && ["work-monitor", "bead-studio"].includes(view));
      assert.equal(viewSupportsPlatform(view, platform), !unavailable, `${view} on ${platform}`);
    }
    for (const view of ["removed-tool", "constructor", "__proto__"] as View[]) {
      assert.equal(viewSupportsPlatform(view, platform), false);
    }
  }
});
