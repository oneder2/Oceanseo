// Isolated browser UI regression, synthetic ring only; no personal images or AI.
async (page) => {
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/', page.url()).href);
  await page.evaluate(async () => {
    const { blankPattern } = await import('/src/beads/model.ts');
    const pattern = blankPattern(80, 60);
    pattern.title = '画布验收：多色闭合轮廓';
    for (let y = 10; y <= 49; y++) for (let x = 15; x <= 64; x++) {
      if (y === 10 || y === 49 || x === 15 || x === 64) pattern.cells[y * 80 + x] = x < 40 ? 1 : 2;
    }
    localStorage.setItem('tideplan.bead-pattern.v1', JSON.stringify(pattern));
  });
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('navigation', { name: '工作区导航' }).getByRole('button', { name: '拼豆图纸', exact: true }).click();
  const studio = page.getByRole('region', { name: '拼豆工坊' });
  const canvas = studio.getByRole('img', { name: '拼豆画布' }).or(studio.locator('canvas[aria-label="拼豆画布"]'));
  const pattern = () => page.evaluate(() => JSON.parse(localStorage.getItem('tideplan.bead-pattern.v1')));
  async function pixels() {
    return canvas.evaluate(element => {
      const { data } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
      const colors = new Set();
      for (let i = 0; i < data.length; i += 64) colors.add([...data.slice(i, i + 4)].join(','));
      return colors.size;
    });
  }
  for (const [width, height] of [[1024, 768], [1440, 960], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    const stage = await studio.locator('.bead-stage').boundingBox();
    const body = await studio.locator('.bead-editor-body').boundingBox();
    check(stage.width >= body.width * .95 && stage.height >= body.height * .8, 'Canvas not prioritized');
    check(stage.width >= 600 && stage.height >= 400, `Canvas too small at ${width}`);
    check(await pixels() > 8, 'Canvas blank or ring missing');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflow');
    await page.screenshot({ path: `output/playwright/oceanseo-beads-${width}.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  const beforeFocus = await canvas.boundingBox();
  await studio.getByRole('button', { name: '专注画布', exact: true }).click();
  await page.waitForTimeout(150);
  check((await canvas.boundingBox()).width > beforeFocus.width + 100, 'Focus did not free navigation space');
  await studio.getByRole('button', { name: '退出专注', exact: true }).click();
  await studio.getByRole('button', { name: '适应画布', exact: true }).click();
  const zoomBefore = await studio.locator('output[aria-label="画布缩放比例"]').textContent();
  await studio.getByRole('button', { name: '放大', exact: true }).click();
  check(await studio.locator('output[aria-label="画布缩放比例"]').textContent() !== zoomBefore, 'Zoom did not change');
  await studio.getByRole('button', { name: '适应画布', exact: true }).click();
  const panBefore = await canvas.evaluate(element => element.toDataURL());
  let box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 10 });
  await page.mouse.up();
  check(await canvas.evaluate(element => element.toDataURL()) !== panBefore, 'Canvas drag did not pan');
  await studio.getByRole('button', { name: '适应画布', exact: true }).click();
  await studio.getByRole('button', { name: '画笔', exact: true }).click();
  box = await canvas.boundingBox();
  const beforePaint = (await pattern()).cells;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(before => JSON.stringify(JSON.parse(localStorage.getItem('tideplan.bead-pattern.v1')).cells) !== JSON.stringify(before), beforePaint);
  const painted = (await pattern()).cells;
  await studio.getByRole('button', { name: '撤销', exact: true }).click();
  check(JSON.stringify((await pattern()).cells) === JSON.stringify(beforePaint), 'Undo not a whole stroke');
  await studio.getByRole('button', { name: '重做', exact: true }).click();
  check(JSON.stringify((await pattern()).cells) === JSON.stringify(painted), 'Redo failed');
  await studio.getByRole('button', { name: '豆色', exact: true }).click();
  const colorPanel = page.getByRole('dialog', { name: '豆色面板' });
  const palette = (await pattern()).palette;
  await colorPanel.getByRole('button', { name: '选择 B02 颜色 2', exact: true }).click();
  check(JSON.stringify((await pattern()).palette) === JSON.stringify(palette), 'Locator changed original colors');
  await colorPanel.getByRole('button', { name: '放大定位图', exact: true }).click();
  const locator = page.getByRole('dialog', { name: '同色定位图' });
  await page.keyboard.press('Escape');
  await locator.waitFor({ state: 'hidden' });
  check(await colorPanel.isVisible(), 'Locator Escape closed parent panel');
  await colorPanel.getByRole('button', { name: '收起面板', exact: true }).click();
  await studio.getByRole('button', { name: '填充与加边', exact: true }).click();
  const shape = page.getByRole('dialog', { name: '填充与加边面板' });
  await shape.getByRole('button', { name: '填充所有空心', exact: true }).click();
  let preview = page.getByRole('dialog', { name: '确认图纸变更' });
  await preview.getByRole('button', { name: '应用图纸', exact: true }).click();
  await preview.waitFor({ state: 'hidden' });
  const filled = await pattern();
  check(filled.cells[30 * 80 + 35] === 1 && filled.cells[0] === -1, 'Fill altered exterior or missed closed hole');
  await shape.getByRole('button', { name: '预览轮廓加厚', exact: true }).click();
  await preview.getByRole('button', { name: '应用图纸', exact: true }).click();
  await preview.waitFor({ state: 'hidden' });
  check((await pattern()).cells.filter(c => c >= 0).length > filled.cells.filter(c => c >= 0).length, 'Outline did not thicken');
  await shape.getByRole('button', { name: '收起面板', exact: true }).click();
  await studio.getByRole('button', { name: '尺寸', exact: true }).click();
  const dimensions = page.getByRole('dialog', { name: '尺寸面板' });
  await dimensions.getByRole('spinbutton', { name: '画布宽度', exact: true }).fill('160');
  await dimensions.getByRole('spinbutton', { name: '画布高度', exact: true }).fill('160');
  await dimensions.getByRole('button', { name: '预览尺寸调整', exact: true }).click();
  await preview.getByRole('button', { name: '应用图纸', exact: true }).click();
  await preview.waitFor({ state: 'hidden' });
  check((await pattern()).cells.length === 25600, 'Large size not applied');
  await dimensions.getByRole('button', { name: '收起面板', exact: true }).click();
  await page.waitForTimeout(150);
  check(await pixels() > 8, 'Large canvas blank');
  await page.screenshot({ path: 'output/playwright/oceanseo-beads-160.png', animations: 'disabled' });
  const downloadPromise = page.waitForEvent('download');
  await studio.getByRole('button', { name: '导出 PNG', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs('output/playwright/oceanseo-beads-export-160.png');
  check((await download.failure()) === null, 'PNG download failed');
  check(errors.length === 0, errors.join('\n'));
}
