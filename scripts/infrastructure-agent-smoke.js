// UI fixture after infrastructure-smoke; no real AI/host calls or credentials.
async(page)=>{
  const check=(v,m)=>{if(!v)throw Error(m);};
  await page.evaluate(()=>{
    window.isTauri=true;window.__infraCalls=[];window.__infraToken=false;
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      window.__infraCalls.push({command,args});
      if(command==="set_app_state")return;
      if(command==="host_credential_configured")return window.__infraToken;
      if(command==="save_host_credential"){window.__infraToken=!!args.token;return;}
      if(command==="check_host_endpoint")return args.source==="http"?{ok:true,detail:"HTTP 200"}:{ok:true,detail:"合成资源采样",metrics:{sampledAt:new Date().toISOString(),cpuPercent:23,memoryPercent:44,diskPercent:91,uptimeSeconds:86400,networkRxBytes:1e9,networkTxBytes:2e9}};
      if(command==="run_planning_agent"){
        if(args.kind==="host_import")return {name:"订单识别草稿",provider:"Fixture",plan:"4GB",region:"Dallas",os:"",purpose:"",source:"截图，续费价格待核实",constraints:"端口速率未说明",currency:"USD",cpu:2,ramGb:4,diskGb:40,bandwidthMbps:0,trafficGb:5000,snapshots:1,amount:9,renewalAmount:0,tax:0,cycleMonths:3};
        return {summary:"采样显示磁盘空间需要检查，不能推断全天状态。",observations:["只有少量样本"],suggestions:[{title:"检查磁盘空间",reason:"最新记录达到91%",hostId:args.context.hosts[0].id,dueDate:""}]};
      }
      throw Error(`Unexpected fixture command ${command}`);
    }};
  });
  await page.locator(".infra-host").first().click();
  const dialog=page.getByRole("dialog");
  await dialog.getByRole("button",{name:"监测",exact:true}).click();
  await dialog.getByLabel("服务健康检查 HTTPS 地址",{exact:true}).fill("https://health.example.test");
  await dialog.getByLabel("资源采集 HTTPS 地址",{exact:true}).fill("https://metrics.example.test/metrics");
  check(await dialog.getByRole("button",{name:"立即检查",exact:true}).isDisabled(),"Unsaved endpoint can be probed");
  await dialog.getByRole("button",{name:"保存档案",exact:true}).click();
  await dialog.getByLabel("采集令牌（与 AI / 同步令牌独立）",{exact:true}).fill("synthetic-collector-token-not-production");
  await dialog.getByRole("button",{name:"保存采集令牌",exact:true}).click();
  await dialog.getByRole("button",{name:"立即检查",exact:true}).click();
  await dialog.getByText("91.0%",{exact:true}).waitFor();
  check(await page.evaluate(()=>!localStorage.getItem("tideplan.infrastructure.v1").includes("synthetic-collector-token")),"Credential leaked into document");
  await dialog.getByRole("button",{name:"关闭详情",exact:true}).click();
  await page.getByText(/磁盘 91.0% 超过阈值/).waitFor();
  await page.getByRole("button",{name:"AI 与周摘要",exact:true}).click();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button",{name:"生成 AI 周摘要",exact:true}).click();
  await dialog.getByText("检查磁盘空间",{exact:true}).waitFor();
  await dialog.getByRole("button",{name:"保存摘要",exact:true}).click();
  await dialog.getByRole("button",{name:"摘要已保存",exact:true}).waitFor();
  const sent=await page.evaluate(()=>JSON.stringify(window.__infraCalls.find(c=>c.command==="run_planning_agent").args.context));
  check(!sent.includes("metrics.example.test")&&!sent.includes("synthetic-collector-token"),"AI received endpoint or token");
  await dialog.getByRole("button",{name:"识别订单",exact:true}).click();
  await dialog.getByLabel("订单文本",{exact:true}).fill("测试套餐，季度9美元");
  await dialog.locator('input[type=file]').setInputFiles("public/favicon.png");
  await dialog.getByAltText("待识别的订单截图",{exact:true}).waitFor();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button",{name:"识别并打开档案草稿",exact:true}).click();
  await page.getByRole("dialog",{name:"添加主机",exact:true}).waitFor();
  check(await dialog.getByLabel("主机名称 *",{exact:true}).inputValue()==="订单识别草稿","Import not editable");
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem("tideplan.infrastructure.v1")).hosts.length)===1,"Import auto-saved without review");
  await dialog.getByRole("button",{name:"保存档案",exact:true}).click();
  await dialog.getByRole("button",{name:"关闭详情",exact:true}).click();
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem("tideplan.infrastructure.v1")).hosts.length)===2,"Import not saved after confirmation");
  await page.locator(".infra-host").filter({hasText:"订单识别草稿"}).click();
  await dialog.getByText("归档与删除",{exact:true}).click();
  await dialog.getByRole("button",{name:"归档主机",exact:true}).click();
  check(await page.locator(".infra-host").count()===1,"Archived host still active");
  await page.getByLabel("主机状态筛选",{exact:true}).selectOption("archived");
  await page.locator(".infra-host").first().click();
  await dialog.getByText("归档与删除",{exact:true}).click();
  await dialog.getByRole("button",{name:"删除档案",exact:true}).click();
  await dialog.getByRole("button",{name:"确认删除档案",exact:true}).click();
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem("tideplan.infrastructure.v1")).hosts.length)===1,"Confirmed delete failed");
  await page.getByLabel("主机状态筛选",{exact:true}).selectOption("active");
  await page.screenshot({path:"output/playwright/infrastructure-monitor-dashboard.png"});
  await page.evaluate(()=>{window.isTauri=false;delete window.__TAURI_INTERNALS__;});
  console.log("PASS: monitor UI, independent token, AI consent/projection/import draft, report save, archive/delete");
}
