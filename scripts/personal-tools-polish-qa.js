async page => {
  const check = (value, message) => { if (!value) throw Error(message); };
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("http://127.0.0.1:1421");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("heading", { name: "总体待办 0", exact: true }).waitFor();
  const nav = page.getByRole("region", { name: "当前工作区工具", exact: true });
  async function add(name) {
    await nav.getByRole("button", { name: "添加工具", exact: true }).click();
    const card = page.locator(".scene-tool-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await card.getByRole("button", { name: /添加工具|恢复工具/ }).click();
    await nav.getByRole("button", { name, exact: true }).waitFor();
  }
  await add("采购清单");
  await nav.getByRole("button", { name: "采购清单", exact: true }).click();
  await page.getByRole("textbox", { name: "物品名称" }).fill("移除后仍保留的咖啡豆");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByText("移除后仍保留的咖啡豆", { exact: true }).waitFor();
  await nav.getByRole("button", { name: "移除工具：采购清单", exact: true }).click();
  await page.getByRole("heading", { name: "总体待办 0", exact: true }).waitFor();
  check(await nav.getByRole("button", { name: "采购清单", exact: true }).count() === 0, "Removed tool must disappear even when its page was open");
  await page.reload();
  await page.getByRole("heading", { name: "总体待办 0", exact: true }).waitFor();
  await add("采购清单");
  await nav.getByRole("button", { name: "采购清单", exact: true }).click();
  await page.getByText("移除后仍保留的咖啡豆", { exact: true }).waitFor();
  await add("拼豆图纸");
  check(await nav.locator(".scene-tool-row").count() === 2, "One navigation row per installed module");
  check(await nav.getByRole("button", { name: "我的作品", exact: true }).count() === 0 && await nav.getByRole("button", { name: "继续拼放", exact: true }).count() === 0, "Legacy bead routes must not be separate tools");
  await nav.getByRole("button", { name: "拼豆图纸", exact: true }).click();
  await page.locator(".bead-workbench").waitFor();
  const moduleNav = page.getByRole("navigation", { name: "拼豆工具内容" });
  await moduleNav.getByRole("button", { name: "作品管理", exact: true }).click();
  await page.getByRole("region", { name: "我的拼豆作品" }).waitFor();
  await page.getByRole("button", { name: "新建作品", exact: true }).click();
  await page.locator(".bead-workbench").waitFor();
  await moduleNav.getByRole("button", { name: "拼放进度", exact: true }).click();
  await page.getByRole("region", { name: "拼豆继续拼", exact: true }).waitFor();
  await moduleNav.getByRole("button", { name: "图纸编辑", exact: true }).click();
  await page.locator(".bead-workbench").waitFor();
  const before = await page.evaluate(() => ({ x: screenX, y: screenY, w: outerWidth, h: outerHeight }));
  await page.getByRole("button", { name: "进入全屏", exact: true }).click();
  await page.locator(".desktop-shell.is-fullscreen").waitFor();
  check(await page.evaluate(() => document.fullscreenElement === null), "Browser preview must leave the system desktop visible");
  check(JSON.stringify(before) === JSON.stringify(await page.evaluate(() => ({ x: screenX, y: screenY, w: outerWidth, h: outerHeight }))), "Browser mode stays inside existing window");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "进入全屏", exact: true }).waitFor();
  const widths = [];
  for (const width of [1400, 780, 620]) {
    await page.setViewportSize({ width, height: 820 });
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, workspace: document.querySelector("main.workspace").clientWidth, scroll: document.querySelector("main.workspace").scrollWidth }));
    check(dimensions.document <= width && dimensions.scroll <= dimensions.workspace + 1, `Bead module overflow at ${width}`);
    widths.push(dimensions);
  }
  await page.screenshot({ path: "output/playwright/personal-tools-polish-beads.png" });
  return { removeOpenTool: true, removalPersists: true, restoreData: true, singleBeadEntry: true, internalBeadFlows: true, browserKeepsDesktop: true, widths };
}
