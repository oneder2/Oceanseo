// UI round trips with an explicit in-browser Tauri/AI stub. No network model calls or real database.
async (page) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const check=(v,m)=>{if(!v)throw Error(m);};
  const fixture=await (await page.request.get(new URL('/tests/fixtures/dialogue-reply.json', page.url()).href)).json();
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'想法与目标',exact:true}).click();
  await page.getByRole('button',{name:'对话与节奏设置',exact:true}).click();
  await page.getByRole('button',{name:'配置共用 AI 服务 ↗',exact:true}).click();
  await page.locator('.ai-key-input input').fill('qa-placeholder-not-a-real-key');
  await page.getByRole('button',{name:'保存 AI 配置',exact:true}).click();
  await page.getByRole('dialog',{name:'偏好设置',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(fixture=>{
    window.qaMode='first';window.qaInputs=[];window.qaTasks=[];
    window.isTauri=true;
    window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
      if(cmd==='set_app_state')return;
      if(cmd==='commit_goal_changes') {
        const r=args.request;
        let tasks=window.qaTasks;
        tasks=tasks.map(t=>r.updateTasks.find(n=>n.id===t.id)||t).concat(r.createTasks);
        window.qaTasks=tasks;
        localStorage.setItem('tideplan.goals.v1',JSON.stringify(r.next));
        localStorage.setItem('tideplan.tasks.v1',JSON.stringify(tasks.map(t=>({schemaVersion:t.schema_version,id:t.id,title:t.title,notes:t.notes,horizon:t.horizon,priority:t.priority,startDate:t.start_date||'',dueDate:t.due_date||'',createdAt:t.created_at,updatedAt:t.updated_at,completedAt:t.completed_at,origin:t.origin}))));
        return {state:r.next,tasks};
      }
      if(cmd==='run_planning_agent') {
        if(args.kind!=='goal_dialogue')throw Error('Unexpected agent kind');
        window.qaInputs.push(structuredClone(args.context));
        if(window.qaMode==='fail')throw Error('模拟网络暂不可用');
        if(window.qaMode==='cancel')return new Promise(resolve=>window.qaResolve=()=>resolve(structuredClone(fixture)));
        const result=structuredClone(fixture);
        if(window.qaMode==='clarify') {
          if(args.context.dialogue.pending.plan.actions[0].minutes!==35)throw Error('User tuning missing from AI request');
          if(!args.context.dialogue.history.some(m=>m.role==='system'&&m.text.includes('35')))throw Error('Tuning explanation missing');
          result.reply='清楚了，旅行以散步放松为主；发布验证保留你调整的35分钟。清单已更新。';
          result.plan.actions[0].minutes=35;result.plan.actions[1].conditions.travel.purpose='散步放松';result.plan.questions=[];result.waiting=[];result.understanding[2].status='clear';result.understanding[2].evidence='你补充：散步放松。';
        }
        if(window.qaMode==='edit') {
          if(args.context.dialogue.receipts.length!==4)throw Error('Execution receipts missing from AI request');
          const existing=args.context.actions.find(a=>a.id==='verify');
          result.reply='已拟定截止日期变更，其他已执行的内容保持原样。';
          result.plan.goals=[];result.plan.actions=[{...result.plan.actions[0],minutes:35,existingTaskId:existing.taskId,draft:{...result.plan.actions[0].draft,dueDate:'2026-10-10'}}];result.plan.questions=[];result.waiting=[];
        }
        return result;
      }
      throw Error('Unexpected native call: '+cmd);
    }};
  },fixture);
  const input=page.getByRole('textbox',{name:'给小汐的消息',exact:true});
  await input.fill('先验证再发布，也想去杭州旅行。');await input.press('Enter');
  await page.getByText(fixture.reply,{exact:true}).waitFor();
  await page.getByRole('button',{name:'打开交付清单',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'最终交付清单',exact:true});
  const action=panel.getByRole('article',{name:'验证升级与恢复',exact:true});
  await action.getByRole('button',{name:'微调参数',exact:true}).click();
  await action.getByRole('spinbutton',{name:'预计分钟',exact:true}).fill('35');
  await action.getByRole('button',{name:'保存微调',exact:true}).click();
  await action.getByText('35 分钟',{exact:false}).first().waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.qaMode='clarify');
  await input.fill('旅行就是散步放松，其他按刚刚微调的来。');await input.press('Enter');
  await page.getByText('清楚了，旅行以散步放松为主；发布验证保留你调整的35分钟。清单已更新。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'打开交付清单',exact:true}).click();
  await panel.getByRole('button',{name:'执行全部可执行项（4）',exact:true}).click();
  await panel.getByRole('heading',{name:'清单中的更改已处理',exact:true}).waitFor();
  check(await page.evaluate(()=>window.qaTasks.length)===2,'Unexpected task count after execution');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.qaMode='edit');
  await input.fill('把验证的截止日改成2026年10月10日。');await input.press('Enter');
  await page.getByText('已拟定截止日期变更，其他已执行的内容保持原样。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'打开交付清单',exact:true}).click();
  check(await panel.getByRole('article').count()===1,'Executed rows reappeared');
  await panel.getByRole('button',{name:'执行本条',exact:true}).click();
  await panel.getByRole('heading',{name:'清单中的更改已处理',exact:true}).waitFor();
  check(await page.evaluate(()=>window.qaTasks.length===2&&window.qaTasks.some(t=>t.due_date==='2026-10-10')),'Update duplicated or failed');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.qaMode='fail');
  await input.fill('再帮我检查一次。');await input.press('Enter');
  await page.getByText('模拟网络暂不可用',{exact:true}).waitFor();
  await page.evaluate(()=>window.qaMode='cancel');
  await page.getByRole('button',{name:'继续 / 重试',exact:true}).click();
  await page.getByRole('button',{name:'停止回复',exact:true}).waitFor();
  await input.fill('停止后保留的下一条草稿');
  await page.getByRole('button',{name:'停止回复',exact:true}).click();
  await page.evaluate(()=>window.qaResolve());
  check(await input.inputValue()==='停止后保留的下一条草稿','Cancellation erased composer');
  check(await page.getByText('再帮我检查一次。',{exact:true}).count()===1,'Retry duplicated user message');
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem('tideplan.goals.v1')).conversation.needsReply),'Late result was applied after cancellation');
  await page.screenshot({path:'output/playwright/conversation-agent-roundtrip.png',animations:'disabled'});
  await page.evaluate(()=>{window.isTauri=false;delete window.__TAURI_INTERNALS__;});
  await page.reload();
  await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'想法与目标',exact:true}).click();
  check(await input.inputValue()==='停止后保留的下一条草稿','Draft not restored');
  check(errors.length===0,errors.join('\n'));
}
