async page => {
  const check = (value, message) => { if (!value) throw Error(message); };
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("http://127.0.0.1:1421");
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.locator(".personal-home").waitFor();
  const sentinel = await page.evaluate(() => { window.__sharingSession = crypto.randomUUID(); window.__sharingShell = document.querySelector(".desktop-shell"); return window.__sharingSession; });
  let navigations = 0; page.on("framenavigated", () => navigations++);
  const nav = page.getByRole("region", { name: "当前工作区工具", exact: true });
  async function stable() {
    check(await page.evaluate(token => window.__sharingSession === token && window.__sharingShell === document.querySelector(".desktop-shell"), sentinel), "Workspace operations must keep the webview and shell");
    check(navigations === 0, "Workspace operations must not navigate the webview");
  }
  async function add(name) {
    await nav.getByRole("button", { name: "添加工具", exact: true }).click();
    await page.locator(".scene-tool-card").filter({ has: page.getByRole("heading", { name, exact: true }) }).getByRole("button", { name: /添加工具|恢复工具/ }).click();
    await page.locator(".scene-dialog").waitFor({state:"hidden"}); await nav.getByRole("button", { name, exact: true }).waitFor(); await stable();
  }
  async function create(name, style) {
    await page.locator(".scene-current").click(); await page.getByRole("button", {name:"新增工作区",exact:true}).click();
    await page.getByRole("textbox",{name:"工作区名称"}).fill(name);
    await page.getByRole("button",{name:style}).click(); await page.getByRole("button",{name:"创建工作区",exact:true}).click();
    await page.locator(".scene-dialog").waitFor({state:"hidden"}); await stable();
  }
  async function switchTo(name) {
    await page.locator(".scene-current").click();
    await page.getByRole("dialog",{name:"切换工作区"}).getByRole("button",{name:name === "主工作区" ? "主工作区 · 主工作区" : name,exact:true}).click();
    await page.waitForFunction(name => document.querySelector(".scene-current strong").textContent === name,name); await stable();
  }
  async function shopping(name) {
    await nav.getByRole("button", {name:"采购清单",exact:true}).click();
    if (name) { await page.getByRole("textbox",{name:"物品名称"}).fill(name); await page.getByRole("button",{name:"添加",exact:true}).click(); }
  }
  await add("采购清单"); await shopping("主工作区的咖啡豆");
  await create("CTO", "探索 石墨青色 · 技术与代码参考"); await create("CEO", "决策 墨蓝秩序 · 工作与创业参考");
  await switchTo("CTO"); await add("采购清单"); await shopping("CTO 的共享信息");
  await page.getByText("主工作区的咖啡豆",{exact:true}).waitFor();
  check(await page.evaluate(() => document.documentElement.dataset.workspaceStyle)==="technical", "Workspace style changes without reload");
  await switchTo("CEO"); await add("采购清单"); await shopping();
  await page.getByText("主工作区的咖啡豆",{exact:true}).waitFor(); await page.getByText("CTO 的共享信息",{exact:true}).waitFor();
  await nav.getByRole("button",{name:"工具操作：采购清单",exact:true}).click();
  await page.getByRole("menuitem",{name:"属性",exact:true}).click();
  const properties = page.getByRole("dialog",{name:"采购清单",exact:true});
  await properties.getByText("所有工作区共享同一份资料",{exact:true}).waitFor(); await properties.getByText("主工作区、CTO、CEO",{exact:true}).waitFor();
  await page.keyboard.press("Escape"); await properties.waitFor({state:"hidden"});
  await nav.getByRole("button",{name:"工具操作：采购清单",exact:true}).click(); await page.getByRole("menuitem",{name:"删除工具",exact:true}).click();
  await nav.getByRole("button",{name:"采购清单",exact:true}).waitFor({state:"hidden"}); await stable();
  await switchTo("CTO"); await shopping(); await page.getByText("CTO 的共享信息",{exact:true}).waitFor();
  await switchTo("CEO"); await add("采购清单"); await shopping(); await page.getByText("CTO 的共享信息",{exact:true}).waitFor();
  for (const name of ["想法与目标","主机与服务","工作观察","拼豆图纸","AI 食谱","训练计划","旅行规划","人物档案","计划日历","关键日期"]) await add(name);
  await page.setViewportSize({width:620,height:560});
  const actions = nav.getByRole("button",{name:"工具操作：旅行规划",exact:true});
  await actions.scrollIntoViewIfNeeded(); await actions.hover(); await actions.click();
  const metrics = await page.evaluate(() => {
    const nav=document.querySelector(".workspace-nav"), button=document.querySelector('[aria-label="工具操作：旅行规划"]'), menu=document.querySelector(".scene-tool-menu");
    const n=nav.getBoundingClientRect(), b=button.getBoundingClientRect(), m=menu.getBoundingClientRect();
    return {scrollable:nav.scrollHeight>nav.clientHeight,gap:n.right-b.right,hit:document.elementFromPoint(b.right-2,b.top+b.height/2)?.closest("button")===button,portal:!menu.closest(".workspace-nav"),menuFits:m.left>=0&&m.top>=0&&m.right<=innerWidth&&m.bottom<=innerHeight,document:document.documentElement.scrollWidth,width:innerWidth};
  });
  check(metrics.scrollable && metrics.gap>=12 && metrics.hit && metrics.portal && metrics.menuFits && metrics.document<=metrics.width,"Scrollbar/menu must keep actions accessible: "+JSON.stringify(metrics));
  await page.screenshot({path:"output/playwright/personal-shared-tools-menu.png",animations:"disabled",timeout:60000});
  await page.keyboard.press("Escape"); await page.getByRole("menu").waitFor({state:"hidden"});
  check(await actions.evaluate(button=>document.activeElement===button),"Escape returns focus to action trigger");
  await stable();
  return {sharedTools:true,removeOnlyCurrentEntry:true,properties:true,webviewReloads:navigations,shellPreserved:true,metrics};
}
