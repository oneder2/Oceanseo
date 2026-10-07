// ONLY a verified fresh com.tideplan.mobile.infraqa installation; adb reverse 4790.
async(page)=>{
  const check=(v,m)=>{if(!v)throw Error(m);};
  const nav=page.getByRole("navigation",{name:"手机主导航"});
  await nav.getByRole("button",{name:"工具",exact:true}).click();
  await page.getByRole("navigation",{name:"工作区导航"}).getByRole("button",{name:"主机与服务",exact:true}).click();
  await page.getByRole("button",{name:"添加主机",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByLabel("主机名称 *",{exact:true}).fill("原生验收 · 本机采集");
  await dialog.getByLabel("用途",{exact:true}).fill("合成验收数据，不是真实 VPS");
  await dialog.getByRole("button",{name:"费用与期限",exact:true}).click();
  await dialog.getByLabel("每期续费金额（不含税）",{exact:true}).fill("9");
  await dialog.getByLabel("账期（月）",{exact:true}).fill("3");
  await dialog.getByRole("button",{name:"下次续费日期：选择日期",exact:true}).click();
  await page.getByRole("dialog",{name:"下次续费日期选择器",exact:true}).getByRole("button",{name:"今天",exact:true}).click();
  await dialog.getByRole("button",{name:"监测",exact:true}).click();
  await dialog.getByLabel("服务健康检查 HTTPS 地址",{exact:true}).fill("http://127.0.0.1:4790/health");
  await dialog.getByLabel("资源采集 HTTPS 地址",{exact:true}).fill("http://127.0.0.1:4790/metrics");
  await dialog.getByRole("button",{name:"保存档案",exact:true}).click();
  await dialog.getByText("档案已保存",{exact:true}).waitFor();
  await dialog.getByLabel("采集令牌（与 AI / 同步令牌独立）",{exact:true}).fill("synthetic-monitor-test-token-123456789");
  await dialog.getByRole("button",{name:"保存采集令牌",exact:true}).click();
  await dialog.getByRole("button",{name:"立即检查",exact:true}).click();
  await dialog.getByText("HTTP 200 · 本机可达，仅代表此端点",{exact:true}).waitFor();
  await dialog.getByText("只读采集成功；网络字节为启动后累计，不是账期用量",{exact:true}).first().waitFor();
  await dialog.getByRole("button",{name:"关闭详情",exact:true}).click();
  await page.getByRole("region",{name:"主机待处理",exact:true}).getByRole("button",{name:"加入任务",exact:true}).first().click();
  const editor=page.getByRole("dialog").filter({has:page.getByRole("textbox",{name:"计划名称",exact:true})});
  await editor.getByRole("button",{name:"保存计划",exact:true}).click();await editor.waitFor({state:"hidden"});
  const result=await page.evaluate(async()=>{
    const invoke=window.__TAURI_INTERNALS__.invoke,backup=await invoke("export_data_backup");
    const data=backup.appState["tideplan.infrastructure.v1"],h=data.hosts[0];
    return {hosts:data.hosts.length,samples:h.samples.length,ok:h.samples.every(s=>s.ok),metrics:!!h.samples.find(s=>s.source==="collector")?.metrics,
      credential:await invoke("host_credential_configured",{hostId:h.id,url:h.collectorUrl}),leaked:JSON.stringify(backup).includes("synthetic-monitor-test-token-123456789"),taskLinked:backup.tasks.some(t=>t.origin?.reference?.startsWith("tideplan:infrastructure:"))};
  });
  check(result.hosts===1&&result.samples===2&&result.ok&&result.metrics&&result.credential&&!result.leaked&&result.taskLinked,JSON.stringify(result));
  console.log("PASS native health, Linux metrics, Keystore credential, backup exclusion and linked task",result);
}
