// Isolated browser + explicit native/AI fixtures. No live AI or real user data.
async (page) => {
  await page.reload();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const check=(v,m)=>{if(!v)throw Error(m);};
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'拼豆图纸',exact:true}).click();
  await page.getByRole('button',{name:'导入',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'导入面板',exact:true});
  await panel.locator('input[type=file]').setInputFiles('output/playwright/astronaut.png');
  await panel.getByAltText('导入原图').waitFor();
  await panel.getByRole('button',{name:'AI 提炼主体',exact:true}).click();
  await panel.getByRole('button',{name:'1 · 识别图片主体',exact:true}).click();
  await panel.getByRole('alert').filter({hasText:'浏览器预览不连接 AI，请在桌面应用中使用共用 AI 配置。'}).waitFor();
  await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const c=canvas.getContext('2d');
    c.fillStyle='#ffffff';c.fillRect(0,0,128,128);c.fillStyle='#213e48';c.fillRect(26,12,76,92);
    c.fillStyle='#edb982';c.fillRect(32,28,64,64);c.fillStyle='#ea604c';c.fillRect(21,89,86,39);
    c.fillStyle='#213e48';c.fillRect(43,48,9,7);c.fillRect(76,48,9,7);c.fillRect(54,75,21,4);
    window.qaImage=canvas.toDataURL();window.qaMode='success';window.qaImageInputs=[];
    window.isTauri=true;window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
      if(cmd==='set_app_state'){localStorage.setItem(args.key,JSON.stringify(args.value));return;}
      if(cmd==='analyze_bead_image'){window.qaImageInputs.push({cmd,...args.request});return {subject:'穿橙色衣服的人物',features:['短发','微笑'],composition:'保留半身和衣服主色'};}
      if(cmd==='generate_bead_image'){
        window.qaImageInputs.push({cmd,...args.request});
        if(window.qaMode==='failure')throw Error('模拟图片服务不支持该模型');
        if(window.qaMode==='cancel')return new Promise(resolve=>window.qaImageResolve=()=>resolve({imageDataUrl:window.qaImage,revisedPrompt:'late test fixture'}));
        return {imageDataUrl:window.qaImage,revisedPrompt:'Explicit local fixture, not real AI output'};
      }
      if(cmd==='plugin:dialog|save')return null;
      throw Error('Unexpected native call '+cmd);
    }};
  });
  await panel.getByRole('button',{name:'1 · 识别图片主体',exact:true}).click();
  const subject=panel.getByRole('textbox',{name:'主体与需保留的特征',exact:true});
  await subject.filter({visible:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.bead-ai textarea')?.value.includes('穿橙色'));
  await subject.fill('穿橙色衣服的人物，保留微笑，简化背景');
  await panel.getByRole('combobox',{name:'图像风格',exact:true}).selectOption('pixel');
  await panel.getByText('图片模型与服务',{exact:true}).click();
  await panel.getByRole('textbox',{name:'图片生成模型',exact:true}).fill('qa-image-model');
  await panel.getByRole('button',{name:'2 · 生成适拼插画',exact:true}).click();
  await panel.getByAltText('AI 生成的适拼插画').waitFor();
  check(await page.evaluate(()=>window.qaImageInputs.at(-1).subject.includes('保留微笑')&&window.qaImageInputs.at(-1).imageModel==='qa-image-model'&&window.qaImageInputs.at(-1).style==='pixel'),'Edited conditions missing');
  check(await page.evaluate(()=>window.qaImageInputs[0].imageDataUrl.startsWith('data:image/png;base64,')),'Source not normalized to PNG');
  await panel.getByRole('button',{name:'对比原图与 AI 插画',exact:true}).click();
  await page.locator('.bead-ai-dialog[open]').waitFor();
  await page.screenshot({path:'output/playwright/bead-ai-comparison.png'});
  await page.keyboard.press('Escape');
  check(await panel.isVisible(),'Escape closed importer');
  const original=await page.evaluate(()=>localStorage.getItem('tideplan.bead-pattern.v1'));
  await panel.getByRole('button',{name:'生成图纸预览',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'确认图纸变更',exact:true});await preview.waitFor();
  check(await page.evaluate(()=>localStorage.getItem('tideplan.bead-pattern.v1'))===original,'Preview changed document');
  await page.screenshot({path:'output/playwright/bead-ai-pattern-preview.png'});
  await preview.getByRole('button',{name:'取消',exact:true}).click();
  await panel.getByRole('button',{name:'生成图纸预览',exact:true}).click();
  await preview.getByRole('button',{name:'应用图纸',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="图纸名称"]')?.value.includes('AI 提炼'));
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  check(await page.evaluate(()=>localStorage.getItem('tideplan.bead-pattern.v1'))===original,'Undo failed');
  await page.evaluate(()=>window.qaMode='failure');
  await panel.getByRole('button',{name:'重新生成插画',exact:true}).click();
  await panel.getByText('模拟图片服务不支持该模型',{exact:false}).waitFor();
  check(await panel.getByAltText('AI 生成的适拼插画').count()===1,'Failure removed prior result');
  await page.evaluate(()=>window.qaMode='cancel');
  await panel.getByRole('button',{name:'重新生成插画',exact:true}).click();
  await panel.getByRole('button',{name:'取消图片处理',exact:true}).click();
  await page.evaluate(()=>window.qaImageResolve());
  check(await panel.getByText('已停止等待，不会采用迟到结果。服务端可能仍在处理并计费，请稍后再试。',{exact:false}).count()===1,'Cancellation did not persist');
  await page.setViewportSize({width:620,height:560});
  await panel.locator('.bead-inspector-scroll').count();
  await panel.getByRole('textbox',{name:'主体与需保留的特征'}).scrollIntoViewIfNeeded();
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Narrow viewport overflow');
  await page.screenshot({path:'output/playwright/bead-ai-narrow.png'});
  await panel.locator('input[type=file]').setInputFiles('output/playwright/rocket.jpg');
  await page.waitForFunction(()=>document.querySelector('.bead-source figcaption')?.textContent.includes('rocket'));
  await page.waitForFunction(()=>document.querySelector('.bead-ai textarea')?.value==='');
  check(await panel.getByAltText('AI 生成的适拼插画').count()===0,'Changing source kept stale generated image');
  await page.evaluate(()=>{window.isTauri=false;delete window.__TAURI_INTERNALS__;});
  check(errors.length===0,errors.join('\n'));
}
