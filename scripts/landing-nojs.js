async (page) => {
  const origin = new URL(page.url()).origin;
  const browser = page.context().browser();
  const context = await browser.newContext({ javaScriptEnabled:false, viewport:{ width:390, height:844 }, acceptDownloads:true });
  try {
    const plain = await context.newPage();
    await plain.goto(origin);
    await plain.getByRole('heading', { name:'Oceanseo.', exact:true }).waitFor();
    await plain.getByRole('link', { name:'下载安装包', exact:true }).scrollIntoViewIfNeeded();
    await plain.screenshot({ path:'output/playwright/landing-nojs.png' });
    if (origin.startsWith('https://')) {
      const downloadPromise = plain.waitForEvent('download');
      await plain.getByRole('link', { name:'下载安装包', exact:true }).click();
      const download = await downloadPromise;
      if (download.suggestedFilename() !== 'Tideplan_0.18.0_android_arm64_internal.apk') throw Error('No-JS download wrong filename');
      await download.cancel();
    }
    await plain.goto(`${origin}/privacy/`);
    await plain.getByRole('heading', { name:'跨设备同步', exact:true }).waitFor();
    console.log('No-JS static download and privacy content verified.');
  } finally { await context.close(); }
}
