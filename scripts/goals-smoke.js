// Historical 0.11 UI only. For 0.12 use conversation-smoke.js and conversation-agent-smoke.js.
// Use an isolated playwright-cli browser on the production preview server.
// Exercises real manual planning UI. It does not call a real AI service.
async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const check = (v, m) => {
    if (!v) throw Error(m);
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("navigation", { name: "工作区导航" })
    .getByRole("button", { name: "想法与目标", exact: true })
    .click();
  await page
    .getByLabel("原始想法与补充")
    .fill(
      "发布有些混乱：先验证升级，再准备说明。训练也想恢复，今天只有一小时。",
    );
  await page.getByRole("button", { name: "存入收集箱", exact: true }).click();
  await page.getByText("待整理", { exact: false }).first().waitFor();
  await page
    .getByRole("button", { name: "手动建一个目标", exact: true })
    .click();
  await page.getByLabel(/^目标名称 /).fill("稳妥发布应用");
  await page
    .getByLabel("做到什么算完成", { exact: true })
    .fill("升级与恢复通过，发布说明齐全。");
  await page
    .getByRole("button", { name: "＋ 下一步行动", exact: true })
    .click();
  await page
    .getByRole("button", { name: "＋ 下一步行动", exact: true })
    .click();
  const editors = page.locator(".goal-action-editor");
  await editors
    .nth(0)
    .getByLabel("具体做什么", { exact: true })
    .fill("验证升级与恢复");
  await editors
    .nth(1)
    .getByLabel("具体做什么", { exact: true })
    .fill("写发布说明");
  await editors.nth(1).getByText("先后关系与执行入口", { exact: true }).click();
  const dependencies = editors
    .nth(1)
    .getByRole("listbox", { name: "等待哪些行动", exact: true });
  await dependencies.selectOption({ label: "验证升级与恢复" });
  await page.locator(".workspace").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: "output/playwright/goals-plan.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "采用整份方案", exact: true }).click();
  await page
    .getByRole("button", { name: "验证升级与恢复的完成状态", exact: true })
    .waitFor();
  check(
    (await page
      .getByRole("region", { name: "现在先做", exact: true })
      .getByRole("heading", { name: "验证升级与恢复", exact: true })
      .count()) === 1,
    "First action not recommended",
  );
  await page.getByRole("button", { name: "撤销这次采用", exact: true }).click();
  await page.getByRole("button", { name: "确认撤销", exact: true }).click();
  await page
    .getByText("已撤销本次方案，原始想法已放回收集箱。", { exact: true })
    .waitFor();
  check(
    (await page.evaluate(
      () => JSON.parse(localStorage.getItem("tideplan.tasks.v1")).length,
    )) === 0,
    "Undo left created tasks",
  );
  // Reopen a new plan using UI; previous adoption remains recorded as undone.
  await page.getByRole("button", { name: "收集与整理", exact: false }).click();
  await page
    .getByRole("button", { name: "手动建一个目标", exact: true })
    .click();
  await page.getByLabel(/^目标名称 /).fill("恢复训练节奏");
  await page
    .getByLabel("做到什么算完成", { exact: true })
    .fill("完成一次训练，并记录实际次数。");
  await page
    .getByRole("button", { name: "＋ 下一步行动", exact: true })
    .click();
  await page
    .getByRole("button", { name: "＋ 下一步行动", exact: true })
    .click();
  await editors
    .nth(0)
    .getByLabel("具体做什么", { exact: true })
    .fill("整理训练条件");
  await editors
    .nth(1)
    .getByLabel("具体做什么", { exact: true })
    .fill("建立轻量训练");
  await editors.nth(1).getByText("先后关系与执行入口", { exact: true }).click();
  const select = editors
    .nth(1)
    .getByRole("listbox", { name: "等待哪些行动", exact: true });
  await select.selectOption({ label: "整理训练条件" });
  await editors
    .nth(1)
    .getByRole("combobox", { name: "在哪里做", exact: true })
    .selectOption("fitness");
  await page.getByRole("button", { name: "采用整份方案", exact: true }).click();
  await page
    .getByRole("button", { name: "整理训练条件的完成状态", exact: true })
    .click();
  await page
    .getByRole("region", { name: "现在先做", exact: true })
    .getByRole("heading", { name: "建立轻量训练", exact: true })
    .waitFor();
  await page.screenshot({
    path: "output/playwright/goals-next-action.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "开始 · 训练计划", exact: true })
    .click();
  await page.getByRole("heading", { name: "训练计划", exact: true }).waitFor();
  check(
    await page
      .locator("input")
      .evaluateAll((inputs) => inputs.some((i) => i.value === "建立轻量训练")),
    "Training seed lost",
  );
  await page.getByRole("button", { name: "返回目标", exact: true }).click();
  await page.getByRole("button", { name: "复盘与节奏", exact: true }).click();
  await page
    .getByLabel("复盘补充", { exact: true })
    .fill("已理清训练条件，今天先建立轻量计划。");
  await page.getByRole("button", { name: "晚间清点", exact: true }).click();
  await page.getByText("清点已保存", { exact: true }).waitFor();
  await page.reload();
  await page
    .getByRole("navigation", { name: "工作区导航" })
    .getByRole("button", { name: "想法与目标", exact: true })
    .click();
  await page.getByRole("button", { name: "复盘与节奏", exact: true }).click();
  await page
    .getByText("已理清训练条件，今天先建立轻量计划。", { exact: true })
    .waitFor();
  await page.setViewportSize({ width: 620, height: 560 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Page exceeds narrow viewport",
  );
  await page.screenshot({
    path: "output/playwright/goals-narrow.png",
    animations: "disabled",
  });
  check(errors.length === 0, errors.join("\n"));
}
