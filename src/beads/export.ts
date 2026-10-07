import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { exportCanvas } from "./render";
import type { BeadPattern } from "./model";

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
