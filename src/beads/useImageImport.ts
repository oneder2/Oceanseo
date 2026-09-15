import { useEffect, useRef, useState } from "react";
import { isPattern, validSize, type BeadPattern } from "./model";
import type { ConvertOptions } from "./convert";

interface Source {
  image: ImageBitmap;
  url: string;
  name: string;
}
export function useImageImport(
  onResult: (p: BeadPattern) => void,
  notify: (message: string) => void,
) {
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<ConvertOptions>({
    width: 48,
    height: 48,
    mode: "photo",
    colors: 16,
    cleanup: 1,
  });
  const [lockRatio, setLockRatio] = useState(true);
  const sourceRef = useRef(source),
    worker = useRef<Worker | null>(null),
    token = useRef(0);
  sourceRef.current = source;
  function cancel() {
    token.current++;
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
  }
  useEffect(
    () => () => {
      token.current++;
      worker.current?.terminate();
      sourceRef.current?.image.close();
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
    },
    [],
  );
  async function select(file?: File) {
    if (!file) return;
    cancel();
    const request = token.current;
    setBusy(true);
    let image: ImageBitmap | undefined;
    try {
      if (
        file.size > 16 * 1024 * 1024 ||
        !/^image\/(png|jpeg|webp|bmp)$/.test(file.type)
      )
        throw new Error("请选择不超过 16 MB 的 PNG、JPEG、WebP 或 BMP 图片");
      image = await createImageBitmap(file);
      if (request !== token.current) {
        image.close();
        return;
      }
      if (image.width * image.height > 16_000_000)
        throw new Error("图片超过 1600 万像素，请先缩小后导入");
      sourceRef.current?.image.close();
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
      setSource({
        image,
        name: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
        url: URL.createObjectURL(file),
      });
      const width = Math.min(options.mode === "pixel" ? 160 : 48, image.width);
      setOptions((o) => ({
        ...o,
        width,
        height: Math.max(
          1,
          Math.min(160, Math.round((width * image!.height) / image!.width)),
        ),
      }));
      notify("图片已读取，请设置解析尺寸后预览");
    } catch (e) {
      image?.close();
      if (request === token.current)
        notify(e instanceof Error ? e.message : "图片无法解码");
    } finally {
      if (request === token.current) setBusy(false);
    }
  }
  function dimension(key: "width" | "height", value: number) {
    setOptions((o) => {
      const next = { ...o, [key]: value };
      if (source && lockRatio && validSize(value)) {
        if (key === "width")
          next.height = Math.max(
            1,
            Math.min(
              160,
              Math.round((value * source.image.height) / source.image.width),
            ),
          );
        else
          next.width = Math.max(
            1,
            Math.min(
              160,
              Math.round((value * source.image.width) / source.image.height),
            ),
          );
      }
      return next;
    });
  }
  function convert() {
    if (
      !source ||
      busy ||
      !validSize(options.width) ||
      !validSize(options.height)
    )
      return;
    const request = ++token.current;
    setBusy(true);
    notify("正在转换图片，可随时取消…");
    try {
      const surface = document.createElement("canvas");
      surface.width = options.width;
      surface.height = options.height;
      const ctx = surface.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("无法读取图片像素");
      ctx.imageSmoothingEnabled = options.mode === "photo";
      ctx.imageSmoothingQuality = "high";
      const ratio = Math.min(
        surface.width / source.image.width,
        surface.height / source.image.height,
      );
      const w = source.image.width * ratio,
        h = source.image.height * ratio;
      ctx.drawImage(
        source.image,
        (surface.width - w) / 2,
        (surface.height - h) / 2,
        w,
        h,
      );
      const data = ctx.getImageData(0, 0, surface.width, surface.height).data;
      const running = new Worker(
        new URL("./convert.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = running;
      running.onmessage = (
        event: MessageEvent<{ pattern?: BeadPattern; error?: string }>,
      ) => {
        running.terminate();
        if (request !== token.current) return;
        worker.current = null;
        setBusy(false);
        if (event.data.error) notify(event.data.error);
        else if (isPattern(event.data.pattern))
          onResult({ ...event.data.pattern, title: source.name });
        else notify("转换结果无效，请调整尺寸后重试");
      };
      running.onerror = () => {
        running.terminate();
        if (request !== token.current) return;
        worker.current = null;
        setBusy(false);
        notify("转换未完成，请缩小尺寸后重试");
      };
      running.postMessage({ data, options }, [data.buffer]);
    } catch (e) {
      worker.current?.terminate();
      worker.current = null;
      setBusy(false);
      notify(e instanceof Error ? e.message : "无法启动图片转换");
    }
  }
  return {
    source,
    busy,
    options,
    setOptions,
    lockRatio,
    setLockRatio,
    select,
    dimension,
    convert,
    cancel: () => {
      cancel();
      notify("已取消图片处理");
    },
  };
}
