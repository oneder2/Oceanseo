// Run after exactly one native BACK with the IME visible. No simulated back.
async (page) => {
  const input = page.getByRole('textbox', { name: '计划名称', exact: true });
  if (!await input.isVisible() || await input.inputValue() !== 'Pixel 原生键盘返回验收') throw Error('First BACK dismissed editor or lost input');
  await page.getByRole('button', { name: /截止日期：/ }).click();
  const picker = page.getByRole('dialog', { name: '截止日期选择器', exact: true });
  await picker.waitFor();
  const dimensions = await picker.evaluate(element => {
    const r = element.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight };
  });
  if (dimensions.left < 0 || dimensions.right > dimensions.width + 1 || dimensions.top < 0 || dimensions.bottom > dimensions.height + 1) throw Error('Picker escaped native viewport');
  return { gate: 'native-ime-back-retains-editor-and-picker-fits', dimensions };
}
