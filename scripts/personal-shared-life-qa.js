async page => {
  await page.goto("http://127.0.0.1:1421");
  await page.evaluate(() => {
    localStorage.clear();
    const cto=crypto.randomUUID(), ceo=crypto.randomUUID();
    const workspace=(id,name,tools=[])=>({id,name,main:id==='main',style:'neutral',deleted:false,tools});
    localStorage.setItem('oceanseo.personal.workspaces.v1:local',JSON.stringify({version:1,revision:0,activeId:ceo,taskOwners:{},workspaces:[workspace('main','主工作区'),workspace(cto,'CTO',[{id:crypto.randomUUID(),module:'people',archived:false}]),workspace(ceo,'CEO')]}));
    localStorage.setItem(`oceanseo.scene.v1:${cto}:tideplan.life.v1`,JSON.stringify({version:1,people:[{id:crypto.randomUUID(),name:'共享的旧人物资料',birthday:'',relationship:'自己',dietary:'',preferences:'',hobbies:'',strengths:'',healthNotes:'',notes:'',archived:false}],training:[],workouts:[],trips:[]}));
  });
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('.scene-current strong')?.textContent==='CEO');
  const origin=await page.evaluate(()=>performance.timeOrigin);
  await page.getByRole('button',{name:'添加工具',exact:true}).click();
  await page.locator('.scene-tool-card').filter({has:page.getByRole('heading',{name:'人物档案',exact:true})}).getByRole('button',{name:'添加工具',exact:true}).click();
  await page.locator('.scene-dialog').waitFor({state:'hidden'});
  await page.getByRole('region',{name:'当前工作区工具'}).getByRole('button',{name:'人物档案',exact:true}).click();
  await page.getByText('共享的旧人物资料',{exact:true}).waitFor();
  if(await page.evaluate(()=>performance.timeOrigin)!==origin)throw Error('Installing a previously hidden shared tool reloaded the page');
  return {legacyLifeMigrated:true,newlyEnabledToolReadsSharedData:true,webviewPreserved:true};
}
