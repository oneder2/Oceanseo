import { convertImage, type ConvertOptions } from "./convert";
self.onmessage = (
  event: MessageEvent<{ data: Uint8ClampedArray; options: ConvertOptions }>,
) => {
  try {
    self.postMessage({
      pattern: convertImage(event.data.data, event.data.options),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "图片转换失败",
    });
  }
};
