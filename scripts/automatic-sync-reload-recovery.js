// Follow automatic-sync-ui-smoke.js once its real beforeunload was dismissed.
async (page) => {
  const check=(value,message)=>{if(!value)throw Error(message);};
  const recovery=page.getByRole('dialog',{name:'正在处理同步',exact:true});
  await recovery.getByRole('button',{name:'重新载入',exact:true}).waitFor({timeout:25000});
  check(await page.evaluate(async()=>{
    // Vite may timestamp imports after an edit. Import the mounted singleton,
    // not a second independent module instance at its untimestamped URL.
    const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/appDataStore.ts')?.name;
    if(!url)throw Error('Mounted persistence module not found');
    const {persistAppState,APP_STATE_KEYS}=await import(url);
    try{await persistAppState(APP_STATE_KEYS.mealChecked,['stale-state']);return false;}
    catch(e){return e.message==='restore_in_progress';}
  }),'Cancelled reload released the data gate');
  check(await recovery.getByRole('button',{name:'重新载入',exact:true}).evaluate(el=>el===document.activeElement),'Recovery action is not keyboard-focused');
  for(const width of [320,390,960]){
    await page.setViewportSize({width,height:844});
    check(await recovery.evaluate(el=>el.scrollWidth<=el.clientWidth),`Recovery overflow at ${width}`);
    await page.screenshot({path:`output/playwright/automatic-sync-reload-recovery-${width}.png`});
  }
  const evidence=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('__autoUiEvidence')??'null'));
  await page.evaluate(()=>window.__restoreNavigation());
  await recovery.getByRole('button',{name:'重新载入',exact:true}).click();
  await recovery.waitFor({state:'hidden'});
  const gate='post-commit cancelled reload stays locked with keyboard recovery';
  const result=evidence?{...evidence,gates:[...evidence.gates,gate]}:{fixture:true,actualHTTP:false,actualNative:false,gates:[gate]};
  await page.evaluate(value=>{window.__autoUiEvidence=value;},result);
  console.log(JSON.stringify(result));
}
