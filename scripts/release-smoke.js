// Run only in a NEW isolated playwright-cli session. Clears that browser's data.
// playwright-cli -s=release-smoke run-code "$(cat scripts/release-smoke.js)"
async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const check = (condition, label) => {
    if (!condition) throw Error(label);
  };
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "工作区导航" })
      .getByRole("button", { name, exact: true })
      .click();
  await page.goto(new URL('/', page.url()).href);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await nav("人物档案");
  await page
    .getByRole("textbox", { name: "姓名", exact: true })
    .fill("回归测试人物");
  await page.getByRole("textbox", { name: "忌口与过敏" }).fill("花生过敏");
  await nav("总览");
  await nav("人物档案");
  check(
    (await page
      .getByRole("textbox", { name: "姓名", exact: true })
      .inputValue()) === "回归测试人物",
    "person draft lost on navigation",
  );
  await page.reload();
  await nav("人物档案");
  check(
    (await page.getByRole("textbox", { name: "忌口与过敏" }).inputValue()) ===
      "花生过敏",
    "person draft lost on restart",
  );
  await page.getByRole("button", { name: "保存档案", exact: true }).click();
  await page.getByRole("textbox", { name: "忌口与过敏" }).fill("未提交的修改");
  await page.getByRole("button", { name: "新增人物", exact: true }).click();
  await page
    .getByRole("textbox", { name: "姓名", exact: true })
    .fill("另一份草稿");
  await page.getByRole("button", { name: /回归测试人物.*自己/ }).click();
  check(
    (await page.getByRole("textbox", { name: "忌口与过敏" }).inputValue()) ===
      "未提交的修改",
    "switching profiles overwrote an existing draft",
  );
  await page.getByRole("button", { name: "放弃当前草稿", exact: true }).click();
  check(
    (await page.getByRole("textbox", { name: "忌口与过敏" }).inputValue()) ===
      "花生过敏",
    "discard did not restore committed profile",
  );
  await nav("训练计划");
  await page.getByLabel("计划名称", { exact: true }).fill("发布回归训练");
  await nav("总览");
  await nav("训练计划");
  check(
    (await page.getByLabel("计划名称", { exact: true }).inputValue()) ===
      "发布回归训练",
    "training draft lost",
  );
  await page
    .getByRole("button", { name: /确认.*日历|保存.*日历|建立.*周期/ })
    .click();
  await page.getByLabel("深蹲 第 1 组", { exact: true }).fill("12");
  await page.reload();
  await nav("训练计划");
  check(
    (await page.getByLabel("深蹲 第 1 组", { exact: true }).inputValue()) ===
      "12",
    "workout draft lost",
  );
  check(
    (await page.getByLabel("深蹲 第 2 组", { exact: true }).inputValue()) ===
      "",
    "unfinished set became a number",
  );
  await page.getByRole("button", { name: "标记训练完成", exact: true }).click();
  check(
    await page
      .getByText("请填写每组的实际完成量；未完成请填 0", { exact: true })
      .isVisible(),
    "incomplete workout accepted",
  );
  await page.getByLabel("深蹲 第 2 组", { exact: true }).fill("10");
  await page.getByLabel("深蹲 第 3 组", { exact: true }).fill("0");
  await page.getByRole("button", { name: "标记训练完成", exact: true }).click();
  await nav("旅行规划");
  await page.getByLabel("行程名称", { exact: true }).fill("发布回归旅行");
  await page.getByLabel("出发地", { exact: true }).fill("上海");
  await page.getByLabel("目的地", { exact: true }).fill("杭州");
  await page
    .getByRole("checkbox", { name: "回归测试人物", exact: true })
    .check();
  await page.reload();
  await nav("旅行规划");
  check(
    (await page.getByLabel("行程名称", { exact: true }).inputValue()) ===
      "发布回归旅行",
    "travel draft lost",
  );
  await page
    .getByRole("button", { name: "保存行程并同步日历", exact: true })
    .click();
  await nav("总览");
  await page
    .getByRole("button", { name: /发布回归旅行/ })
    .first()
    .click();
  check(
    (await page.getByLabel("行程名称", { exact: true }).inputValue()) ===
      "发布回归旅行",
    "dashboard link did not open saved trip",
  );
  await nav("总览");
  await page.screenshot({
    path: "output/playwright/release-0.9.1-dashboard.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "添加计划", exact: true }).click();
  await page.getByPlaceholder("例如：整理本周工作重点").fill("未提交任务草稿");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "添加计划", exact: true }).click();
  check(
    (await page.getByPlaceholder("例如：整理本周工作重点").inputValue()) ===
      "未提交任务草稿",
    "task draft lost",
  );
  await page.getByRole("button", { name: "保存计划", exact: true }).click();
  await nav("所有计划");
  await page
    .getByRole("button", { name: "未提交任务草稿的记事本", exact: true })
    .click();
  await page.getByLabel("相关笔记", { exact: true }).fill("记事本重启恢复检查");
  // Browser preview keeps committed tasks in memory. Seed its supported legacy
  // fixture for reload; actual SQLite restart persistence has separate Rust tests.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith("tideplan.draft.notebook:"));
    if (!key) throw Error("notebook journal missing");
    localStorage.setItem("tideplan.tasks.v1", JSON.stringify([{ id: key.slice("tideplan.draft.notebook:".length), title: "未提交任务草稿", notes: "", horizon: "short", priority: "normal", startDate: "", dueDate: "", createdAt: new Date().toISOString(), completedAt: null }]));
  });
  await page.reload();
  await nav("所有计划");
  await page
    .getByRole("button", { name: "未提交任务草稿的记事本", exact: true })
    .click();
  check(
    (await page.getByLabel("相关笔记", { exact: true }).inputValue()) ===
      "记事本重启恢复检查",
    "notebook draft lost",
  );
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await nav("人物档案");
  await page.getByRole("button", { name: /回归测试人物.*自己/ }).click();
  await page.getByRole("button", { name: "清除个人信息", exact: true }).click();
  await page
    .getByRole("button", { name: "确认清除个人信息", exact: true })
    .click();
  check(
    (await page
      .getByRole("textbox", { name: "姓名", exact: true })
      .inputValue()) === "已清除档案的人物",
    "profile was not anonymized",
  );
  await nav("旅行规划");
  check(
    await page.getByRole("checkbox", { name: /已清除档案的人物/ }).isChecked(),
    "anonymization broke historical trip references",
  );
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  check(
    (await page.getByLabel("模型名称").inputValue()) === "gpt-5.6",
    "shared model missing",
  );
  check(
    await page
      .getByRole("button", { name: "测试已保存配置", exact: true })
      .isDisabled(),
    "unconfigured service test should be disabled",
  );
  await page.screenshot({
    path: "output/playwright/release-0.9.1-settings.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 640, height: 700 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "narrow viewport overflows horizontally",
  );
  await page.screenshot({
    path: "output/playwright/release-0.9.1-narrow.png",
    fullPage: true,
    animations: "disabled",
  });
  check(errors.length === 0, errors.join("\n"));
  return {
    passed: true,
    scenarios: [
      "person draft",
      "profile switching and discard",
      "training draft",
      "unfinished workout",
      "travel draft",
      "dashboard links",
      "task draft",
      "notebook draft",
      "profile anonymization",
      "AI settings",
      "640px layout",
    ],
    pageErrors: errors,
  };
}
