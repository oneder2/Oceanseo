// playwright-cli on isolated Vite :4173. Only public fixture photos, no AI call.
async (page) => {
  const visual = await page.context().newPage();
  await visual.goto('http://127.0.0.1:4173/');
  const metrics = await visual.evaluate(async () => {
    const { convertImage } = await import('/src/beads/convert.ts');
    const { resampleImage } = await import('/src/beads/resample.ts');
    const { boundaryScene, diagonalScene } = await import('/tests/fixtures/bead-boundaries.ts');
    const sheet = document.createElement('canvas'); sheet.width = 1230; sheet.height = 1630;
    const out = sheet.getContext('2d'); out.fillStyle='#f5f5ee';out.fillRect(0,0,sheet.width,sheet.height);
    const entries = [{name:'Two / three-colour junctions',...boundaryScene()}, {name:'Four-colour diagonal sampling',...diagonalScene()}];
    for (const [name,url] of [['NASA portrait','/output/playwright/astronaut.png'],['Launch / landscape','/output/playwright/rocket.jpg']]) {
      const image = new Image(); image.src=url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      canvas.getContext('2d').drawImage(image,0,0);
      entries.push({name,width:image.width,height:image.height,data:canvas.getContext('2d').getImageData(0,0,image.width,image.height).data});
    }
    const measure = p => {
      let isolated=0;const seen=new Set();let smallRegions=0;
      p.cells.forEach((c,i)=>{
        if(c<0||seen.has(i))return;const queue=[i];seen.add(i);
        for(let n=0;n<queue.length;n++){const at=queue[n],x=at%p.width,y=Math.floor(at/p.width);
          for(const j of [x>0?at-1:-1,x+1<p.width?at+1:-1,y>0?at-p.width:-1,y+1<p.height?at+p.width:-1])if(j>=0&&!seen.has(j)&&p.cells[j]===c){seen.add(j);queue.push(j);}}
        if(queue.length===1)isolated++;if(queue.length<=4)smallRegions++;
      });return {colors:p.palette.length,isolated,smallRegions};
    };
    const results=[];
    for(let row=0;row<entries.length;row++) {
      const e=entries[row], h=64,w=Math.max(1,Math.round(64*e.width/e.height)), options={width:w,height:h,colors:row<2?24:16,mode:'photo',cleanup:2,brand:'MARD'};
      const start=performance.now();
      const before=convertImage(resampleImage(e.data,e.width,e.height,w,h,'photo'),{...options,boundaryCleanup:false});
      const after=convertImage(resampleImage(e.data,e.width,e.height,w,h,'photo',true),options);
      const stats={name:e.name,before:measure(before),after:measure(after),elapsedMs:Math.round(performance.now()-start)};
      if(e.seams){const body=new Set([after.cells[10*64+20],after.cells[10*64+45],after.cells[45*64+45]]);stats.remainingSeamCells=e.seams.filter(i=>!body.has(after.cells[i])).length;}
      results.push(stats);
      const top=row*405;
      out.fillStyle='#243f34';out.font='bold 20px sans-serif';out.fillText(e.name,20,top+27);
      const raw=document.createElement('canvas');raw.width=e.width;raw.height=e.height;raw.getContext('2d').putImageData(new ImageData(e.data,e.width,e.height),0,0);
      out.drawImage(raw,20,top+65,Math.min(365,320*e.width/e.height),320);
      for(const [col,label,p] of [[1,'Before',before],[2,'After',after]]){
        const left=20+col*405,cell=Math.min(365/w,320/h);
        out.fillStyle='#243f34';out.font='16px sans-serif';out.fillText(label+' · '+JSON.stringify(measure(p)),left,top+54);
        p.cells.forEach((c,i)=>{if(c<0)return;out.fillStyle=p.palette[c].hex;out.fillRect(left+(i%w)*cell,top+65+Math.floor(i/w)*cell,cell+0.1,cell+0.1);});
      }
    }
    document.body.replaceChildren(sheet);document.body.style.margin='0';return results;
  });
  console.log(JSON.stringify(metrics));
  await page.evaluate(value => { window.qaQualityMetrics = value; }, metrics);
  await visual.setViewportSize({width:1230,height:1630});
  await visual.screenshot({path:'output/playwright/bead-boundary-comparison.png'});
  await visual.close();
}
