import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { exportCanvas } from "./render";
import { colorCode, counts, formatCm, physicalSize, type BeadPattern } from "./model";

export async function exportSourceImage(dataUrl: string, title: string) {
  if (!dataUrl.startsWith("data:image/png;base64,"))
    throw Error("图片格式无效");
  const blob = await (await fetch(dataUrl)).blob();
  const name = `${title.replace(/[\\/:*?"<>|]/g, "_") || "适拼插画"}.png`;
  if (isTauri()) {
    const path = await save({
      title: "保存 AI 插画",
      defaultPath: name,
      filters: [{ name: "PNG 图片", extensions: ["png"] }],
    });
    if (path) await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  } else {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = name;
    link.click();
  }
}

export async function exportPattern(p: BeadPattern) {
  const canvas = exportCanvas(p);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG 编码失败"))),
      "image/png",
    ),
  );
  const name = `${p.title.replace(/[\\/:*?"<>|]/g, "_") || "拼豆图纸"}.png`;
  if (isTauri()) {
    const path = await save({
      title: "导出完整拼豆图纸",
      defaultPath: name,
      filters: [{ name: "PNG 图片", extensions: ["png"] }],
    });
    if (!path) return "已取消导出";
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  } else {
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return `已导出完整 PNG · ${canvas.width} × ${canvas.height} 像素`;
}

function pdfText(value: string) {
  // Built-in PDF Helvetica is deliberately used here so the export remains
  // dependency-free. Color codes and dimensions are ASCII and remain legible
  // even when a pattern title or color name contains CJK text.
  return value.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (char) => `\\${char}`);
}
function pdfRgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${((n >> 16) & 255) / 255} ${((n >> 8) & 255) / 255} ${(n & 255) / 255}`;
}
function pdfPage(pattern: BeadPattern, page: number, totalPages: number, legendStart: number) {
  const W = 595, H = 842, margin = 28;
  const content: string[] = [];
  const text = (value: string, x: number, y: number, size = 9, bold = false) => {
    content.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(value)}) Tj ET`);
  };
  if (page === 0) {
    const size = physicalSize(pattern), used = counts(pattern).filter(Boolean).length;
    text("Oceanseo Beads - pattern sheet", margin, H - 34, 16, true);
    text(`${pattern.width} x ${pattern.height} grid | ${used} colors | bead pitch ${size.pitch} mm`, margin, H - 54, 9);
    text(`canvas ${formatCm(size.canvas.width)} x ${formatCm(size.canvas.height)} cm | coordinates start at (1,1)`, margin, H - 69, 8);
    const top = H - 98, maxW = W - margin * 2, maxH = H - 210;
    const cell = Math.min(5, maxW / pattern.width, maxH / pattern.height);
    const left = margin + (maxW - pattern.width * cell) / 2;
    const bottom = top - pattern.height * cell;
    pattern.cells.forEach((index, i) => {
      const x = left + (i % pattern.width) * cell, y = bottom + (pattern.height - 1 - Math.floor(i / pattern.width)) * cell;
      const color = index >= 0 ? pattern.palette[index] : undefined;
      content.push(`${color ? pdfRgb(color.hex) : "0.96 0.97 0.97"} rg ${x.toFixed(2)} ${y.toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`);
      content.push(`0.45 0.55 0.58 RG 0.25 w ${x.toFixed(2)} ${y.toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re S`);
      if (color && cell >= 8) {
        const label = pdfText(colorCode(index, pattern));
        content.push(`BT /F2 ${Math.max(4.2, Math.min(6.5, cell * 0.32)).toFixed(2)} Tf ${pdfRgb(color.hex)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${label}) Tj ET`);
      }
    });
    content.push(`0.15 0.30 0.35 RG 1 w ${left.toFixed(2)} ${bottom.toFixed(2)} ${(pattern.width * cell).toFixed(2)} ${(pattern.height * cell).toFixed(2)} re S`);
    text(`Material legend on page ${legendStart + 1}`, margin, 46, 8);
  } else {
    const tally = counts(pattern), rows = tally.map((n, i) => ({ n, i })).filter(v => v.n);
    text("Oceanseo Beads - material legend", margin, H - 34, 16, true);
    text(`page ${page + 1} / ${totalPages} | quantities are pre-iron estimates`, margin, H - 54, 9);
    const start = (page - 1) * 30;
    rows.slice(start, start + 30).forEach(({ n, i }, index) => {
      const x = margin + (index % 2) * 270, y = H - 88 - Math.floor(index / 2) * 46, color = pattern.palette[i];
      content.push(`${pdfRgb(color.hex)} rg ${x} ${y - 10} 24 24 re f 0.4 0.5 0.52 RG 0.5 w ${x} ${y - 10} 24 24 re S`);
      text(`${colorCode(i, pattern)}  ${n} beads  ${color.hex.toUpperCase()}`, x + 34, y + 2, 10, true);
      text(`${color.brand ?? "custom"} / ${color.name}`, x + 34, y - 13, 8);
    });
    text("Check the physical brand card before purchasing. PDF is a guide, not a certified 1:1 cutting template.", margin, 34, 7);
  }
  return content.join("\n");
}

function createPdf(pattern: BeadPattern) {
  const used = counts(pattern).filter(Boolean).length;
  const pages = Math.max(1, 1 + Math.ceil(used / 30));
  const objects: string[] = [];
  const add = (value: string) => { objects.push(value); return objects.length; };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pagesId = add("");
  const contentIds: number[] = [];
  for (let page = 0; page < pages; page++) {
    const body = pdfPage(pattern, page, pages, 1);
    contentIds.push(add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`));
  }
  const pageIds: number[] = [];
  for (let page = 0; page < pages; page++) pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${contentIds[page]} 0 R >>`));
  const pageRefs = pageIds.map(id => `${id} 0 R`).join(" ");
  objects[pagesId - 1] = `<< /Type /Pages /Count ${pages} /Kids [${pageRefs}] >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  // The pages object was reserved before page objects were added; its ID is
  // therefore stable and the catalog points at the same object.
  const header = "%PDF-1.4\n";
  let output = header, offset = [0];
  for (let index = 0; index < objects.length; index++) {
    offset.push(new TextEncoder().encode(output).length);
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = new TextEncoder().encode(output).length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++) output += `${String(offset[index]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}

export async function exportPatternPdf(p: BeadPattern) {
  const bytes = createPdf(p);
  const name = `${p.title.replace(/[\\/:*?"<>|]/g, "_") || "拼豆图纸"}.pdf`;
  if (isTauri()) {
    const path = await save({ title: "导出 A4 拼豆图纸", defaultPath: name, filters: [{ name: "PDF 图纸", extensions: ["pdf"] }] });
    if (!path) return "已取消导出";
    await writeFile(path, bytes);
  } else {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), link = document.createElement("a");
    link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return `已导出 A4 PDF · ${Math.max(1, 1 + Math.ceil(counts(p).filter(Boolean).length / 30))} 页`;
}
