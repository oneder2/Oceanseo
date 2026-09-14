import { colorCode, counts, ink, type BeadPattern } from "./model";
export function drawPattern(
  ctx: CanvasRenderingContext2D,
  p: BeadPattern,
  cell: number,
  ox: number,
  oy: number,
  width: number,
  height: number,
  labels: boolean,
  coordinates = true,
) {
  const x0 = Math.max(0, Math.floor(-ox / cell)),
    x1 = Math.min(p.width, Math.ceil((width - ox) / cell));
  const y0 = Math.max(0, Math.floor(-oy / cell)),
    y1 = Math.min(p.height, Math.ceil((height - oy) / cell));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.max(7, cell * 0.28)}px monospace`;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const index = p.cells[y * p.width + x],
        color = p.palette[index];
      ctx.fillStyle = color?.hex ?? ((x + y) % 2 ? "#f3f5f5" : "#ffffff");
      ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
      if (color && labels && cell >= 18) {
        ctx.fillStyle = ink(color.hex);
        ctx.fillText(
          colorCode(index),
          ox + (x + 0.5) * cell,
          oy + (y + 0.5) * cell,
          cell - 2,
        );
      }
    }
  for (let x = x0; x <= x1; x++) {
    ctx.strokeStyle = x % 5 === 0 ? "#536b7a99" : "#51687930";
    ctx.lineWidth = x % 5 === 0 ? 1.3 : 0.5;
    ctx.beginPath();
    ctx.moveTo(ox + x * cell, Math.max(0, oy));
    ctx.lineTo(ox + x * cell, Math.min(height, oy + p.height * cell));
    ctx.stroke();
  }
  for (let y = y0; y <= y1; y++) {
    ctx.strokeStyle = y % 5 === 0 ? "#536b7a99" : "#51687930";
    ctx.lineWidth = y % 5 === 0 ? 1.3 : 0.5;
    ctx.beginPath();
    ctx.moveTo(Math.max(0, ox), oy + y * cell);
    ctx.lineTo(Math.min(width, ox + p.width * cell), oy + y * cell);
    ctx.stroke();
  }
  ctx.strokeStyle = "#273e4c";
  ctx.lineWidth = 2;
  ctx.strokeRect(ox, oy, p.width * cell, p.height * cell);
  if (!coordinates) return;
  const step = cell >= 26 ? 1 : cell >= 10 ? 5 : 10;
  ctx.font = "11px monospace";
  function mark(text: string, x: number, y: number) {
    ctx.fillStyle = "#f7f9fbef";
    ctx.fillRect(x - 15, y - 8, 30, 16);
    ctx.fillStyle = "#334d5b";
    ctx.fillText(text, x, y);
  }
  for (let x = x0; x < x1; x++)
    if (x === 0 || x === p.width - 1 || (x + 1) % step === 0)
      mark(String(x + 1), ox + (x + 0.5) * cell, Math.max(12, oy - 15));
  for (let y = y0; y < y1; y++)
    if (y === 0 || y === p.height - 1 || (y + 1) % step === 0)
      mark(String(y + 1), Math.max(16, ox - 22), oy + (y + 0.5) * cell);
}
export function exportCanvas(p: BeadPattern) {
  const cell = Math.max(p.width, p.height) > 100 ? 28 : 36;
  const tally = counts(p),
    used = tally.map((n, i) => ({ n, i })).filter((v) => v.n);
  const width = Math.max(720, p.width * cell + 112),
    columns = Math.max(1, Math.floor((width - 96) / 270));
  const legendY = 128 + p.height * cell + 54,
    height = legendY + 48 + Math.ceil(used.length / columns) * 42 + 70;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建导出画布");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#263b46";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText(p.title, 48, 42, width - 96);
  ctx.font = "15px sans-serif";
  ctx.fillText(
    `${p.width} × ${p.height} 格 · ${tally.reduce((a, b) => a + b, 0)} 颗豆 · ${used.length} 色 · 左上角 (1,1)`,
    48,
    74,
  );
  drawPattern(ctx, p, cell, 56, 128, width, legendY, true);
  ctx.textAlign = "left";
  ctx.fillStyle = "#263b46";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("用色清单 · 应用内编号，请核对实体豆颜色", 48, legendY);
  used.forEach(({ n, i }, k) => {
    const x = 48 + (k % columns) * 270,
      y = legendY + 28 + Math.floor(k / columns) * 42;
    ctx.fillStyle = p.palette[i].hex;
    ctx.fillRect(x, y - 10, 26, 26);
    ctx.strokeStyle = "#71848a";
    ctx.strokeRect(x, y - 10, 26, 26);
    ctx.fillStyle = "#263b46";
    ctx.font = "13px sans-serif";
    ctx.fillText(
      `${colorCode(i)} ${p.palette[i].name} · ${n} 颗`,
      x + 35,
      y,
      220,
    );
    ctx.font = "11px monospace";
    ctx.fillText(p.palette[i].hex.toUpperCase(), x + 35, y + 15);
  });
  ctx.fillStyle = "#657984";
  ctx.font = "13px sans-serif";
  ctx.fillText(
    "潮汐计划 · 拼豆工坊   /   空白格不放豆 · 每五格加粗 · PNG 非实体尺寸打印模板",
    48,
    height - 28,
    width - 96,
  );
  return canvas;
}
