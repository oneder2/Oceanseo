// Isolated, explicitly seeded business conditions fixture. No live AI output.
async (page) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const check=(v,m)=>{if(!v)throw Error(m);};
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{
    const now=new Date().toISOString();
    const examples=[
      {title:'建立引体向上训练',destination:'fitness',conditions:{training:{intervalDays:3,cycles:8,exercises:[{name:'引体向上',sets:2,reps:5,unit:'次'}]},travel:null,shopping:null,meals:null}},
      {title:'安排杭州短途旅行',destination:'travel',conditions:{training:null,travel:{origin:'上海',destination:'杭州',budget:1200,purpose:'轻松散步',transport:'高铁',accommodation:'经济酒店'},shopping:null,meals:null}},
      {title:'补充早餐食材',destination:'shopping-list',conditions:{training:null,travel:null,shopping:{name:'鸡蛋',amount:'12个',category:'食品'},meals:null}},
      {title:'规划一人餐',destination:'meal-planner',conditions:{training:null,travel:null,shopping:null,meals:{people:1,budget:260,dietaryPreference:'家常',allergies:'花生',healthGoal:'均衡'}}},
    ];
    const tasks=examples.map(e=>({schemaVersion:'1.0.0',id:crypto.randomUUID(),title:e.title,notes:'明确条件已在方案中检查',horizon:'short',priority:'normal',startDate:'',dueDate:'',createdAt:now,updatedAt:now,completedAt:null,origin:{kind:'local',label:'QA fixture',reference:null}}));
    const actions=examples.map((e,i)=>({id:crypto.randomUUID(),goalId:'goal1',taskId:tasks[i].id,dependsOn:[],minutes:15,energy:'normal',blocker:'',deferredUntil:'',destination:e.destination,targetId:'',targetDate:'',conditions:e.conditions}));
    localStorage.setItem('tideplan.tasks.v1',JSON.stringify(tasks));
    localStorage.setItem('tideplan.goals.v1',JSON.stringify({version:1,revision:0,thoughts:[],draft:'',goals:[{id:'goal1',parentId:'',title:'照顾好本周生活',criterion:'按真实记录清点',status:'active',reviewDate:''}],actions,proposals:[],reviews:[],preferences:{minutes:60,energy:'normal',dailyLimit:3,checkins:false,autoReview:false,reviewTime:'19:00',reviewWeekday:0},operations:[],undo:null}));
  });
  await page.reload();
  const navigate=async()=>{
    await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'想法与目标',exact:true}).click();
    await page.getByRole('button',{name:'目标与行动',exact:true}).click();
  };
  const start=async(title)=>{await navigate();await page.locator('.goal-live-title').filter({hasText:title}).locator('button').nth(1).click();};
  await start('建立引体向上训练');
  await page.getByRole('heading',{name:'训练计划',exact:true}).waitFor();
  const inputs=await page.locator('input').evaluateAll(a=>a.map(e=>e.value));
  for(const value of ['建立引体向上训练','引体向上','3','8','2','5'])check(inputs.includes(value),`Training condition missing: ${value}`);
  await page.screenshot({path:'output/playwright/goal-training-handoff.png',animations:'disabled'});
  await start('安排杭州短途旅行');
  check(await page.getByLabel('出发地',{exact:true}).inputValue()==='上海','Origin lost');
  check(await page.getByLabel('目的地',{exact:true}).inputValue()==='杭州','Destination lost');
  check(await page.getByLabel('全程总预算（元）',{exact:true}).inputValue()==='1200','Trip budget lost');
  await start('补充早餐食材');
  check(await page.locator('.purchase-add-bar input').evaluateAll(a=>a.some(e=>e.value==='鸡蛋')),'Purchase name lost');
  check(await page.locator('.purchase-add-bar input').evaluateAll(a=>a.some(e=>e.value==='12个')),'Purchase amount lost');
  await page.locator('.purchase-add-bar button[type=submit]').click();
  await page.locator('.purchase-item-copy').filter({hasText:'鸡蛋'}).waitFor();
  await page.getByRole('button',{name:'已采购 鸡蛋',exact:true}).click();
  await navigate();
  await page.locator('.goal-live-title').filter({hasText:'补充早餐食材'}).locator('.goal-check svg').waitFor();
  await start('规划一人餐');
  check(await page.getByRole('spinbutton',{name:'每周预算金额',exact:true}).inputValue()==='260','Meal budget lost');
  const mealInputs=await page.locator('input').evaluateAll(a=>a.map(e=>e.value));
  check(mealInputs.includes('1')&&mealInputs.includes('花生'),'Meal participants or allergies lost');
  await page.screenshot({path:'output/playwright/goal-meals-handoff.png',animations:'disabled'});
  check(errors.length===0,errors.join('\n'));
}
