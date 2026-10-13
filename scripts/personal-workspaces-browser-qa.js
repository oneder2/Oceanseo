async page => {
  const assert = (value, message) => { if (!value) throw Error(message); };
  await page.goto("http://127.0.0.1:1421");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("heading", { name: "总体待办 0", exact: true }).waitFor();
  assert(await page.locator(".scene-navigation").last().getByRole("button").count() === 1, "Default workspace must have zero tools");
  await page.getByRole("button", { name: "工作区设置", exact: true }).click();
  assert(await page.getByRole("button", { name: "删除这个工作区", exact: true }).count() === 0, "Main workspace must not expose deletion");
  await page.getByRole("button", { name: "关闭工作区面板", exact: true }).click();
  async function create(name, style) {
    await page.locator(".scene-current").click();
    await page.getByRole("button", { name: "新增工作区", exact: true }).click();
    await page.getByRole("textbox", { name: "工作区名称", exact: true }).fill(name);
    await page.getByRole("button", { name: style }).click();
    await page.getByRole("button", { name: "创建工作区", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  async function switchTo(name) {
    await page.locator(".scene-current").click();
    await page.locator(".scene-options").getByRole("button", { name, exact: true }).click();
    await page.locator(".scene-current strong").filter({ hasText: name.replace(" · 主工作区", "") }).waitFor();
  }
  await create("CEO", "决策 墨蓝秩序 · 工作与创业参考");
  await create("生活花园", "日常 暖白柔绿 · 生活参考");
  await switchTo("CEO");
  assert(await page.locator("html").getAttribute("data-workspace-style") === "executive", "Workspace style must persist");
  async function installShopping() {
    await page.getByRole("button", { name: "添加工具", exact: true }).click();
    await page.locator(".scene-tool-card").filter({ has: page.getByRole("heading", { name: "采购清单", exact: true }) }).getByRole("button", { name: "添加工具", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "采购清单", exact: true }).click();
  }
  await installShopping();
  await page.getByRole("textbox", { name: "物品名称" }).fill("CEO 的咖啡豆");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByText("CEO 的咖啡豆", { exact: true }).waitFor();
  await switchTo("生活花园");
  assert(await page.getByRole("button", { name: "采购清单", exact: true }).count() === 0, "Installed tool must not leak across workspaces");
  await installShopping();
  assert(await page.getByText("CEO 的咖啡豆", { exact: true }).count() === 0, "Tool content must be isolated");
  await page.getByRole("textbox", { name: "物品名称" }).fill("生活花园的番茄");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByText("生活花园的番茄", { exact: true }).waitFor();
  await switchTo("CEO");
  await page.getByRole("button", { name: "采购清单", exact: true }).click();
  await page.getByText("CEO 的咖啡豆", { exact: true }).waitFor();
  assert(await page.getByText("生活花园的番茄", { exact: true }).count() === 0, "Returning to source must preserve its own list");
  async function addTask(title, owner) {
    await page.getByRole("button", { name: "所有待办", exact: true }).click();
    await page.getByRole("button", { name: "新计划", exact: true }).click();
    await page.locator("[role=dialog] input[maxlength='200']").fill(title);
    await page.getByRole("combobox", { name: "所属工作区", exact: true }).selectOption({ label: owner });
    await page.getByRole("button", { name: "保存计划", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  await addTask("CEO 的任务", "CEO");
  await addTask("未分类的任务", "待定");
  await addTask("生活花园的任务", "生活花园");
  await switchTo("生活花园");
  await page.getByRole("button", { name: "所有待办", exact: true }).click();
  const titles = await page.locator(".task-card .task-title-row strong").allTextContents();
  assert(titles.join("|") === "生活花园的任务|未分类的任务|CEO 的任务", "Current workspace tasks must sort first without hiding others");
  await page.getByRole("button", { name: "工作区设置", exact: true }).click();
  await page.getByRole("textbox", { name: "工作区名称", exact: true }).fill("我的日常");
  await page.getByRole("button", { name: "保存工作区", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.locator(".scene-current strong").filter({ hasText: "我的日常" }).waitFor();
  assert(await page.locator(".task-workspace-label").filter({ hasText: "我的日常" }).count() === 1, "Task ownership follows workspace rename");
  await page.getByRole("button", { name: "工作区设置", exact: true }).click();
  await page.getByRole("button", { name: "删除这个工作区", exact: true }).click();
  await page.getByRole("button", { name: "确认删除工作区", exact: true }).click();
  await page.getByRole("heading", { name: "总体待办 3", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "按工作区筛选待办", exact: true }).selectOption({ label: "待定" });
  assert(await page.locator(".personal-home-task").count() === 2, "Workspace deletion preserves and unassigns its task");
  await page.getByRole("combobox", { name: "按工作区筛选待办", exact: true }).selectOption({ label: "所有工作区" });
  await page.getByRole("textbox", { name: "天气城市", exact: true }).fill("Beijing");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await page.locator(".personal-weather>strong").filter({ hasText: "°C" }).waitFor({ timeout: 45000 });
  await page.screenshot({ path: "output/playwright/personal-workspaces-home.png", fullPage: true });
  await page.setViewportSize({ width: 780, height: 820 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Narrow Linux window must not overflow");
  await page.screenshot({ path: "output/playwright/personal-workspaces-narrow.png", fullPage: true });
  await page.setViewportSize({ width: 1400, height: 950 });
  return { zeroTools: true, mainProtected: true, customWorkspaces: true, themes: true, moduleIsolation: true, sharedTasks: true, priorityByWorkspace: true, rename: true, deleteToPending: true, narrowLayout: true, liveWeather: true };
}
