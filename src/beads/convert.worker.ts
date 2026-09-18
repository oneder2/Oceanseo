import { convertImage, type ConvertOptions } from "./convert";
import { resampleImage } from "./resample";
self.onmessage = (
  event: MessageEvent<{
    data: Uint8ClampedArray;
    sourceWidth: number;
    sourceHeight: number;
    options: ConvertOptions;
  }>,
) => {
  try {
    self.postMessage({
      pattern: convertImage(
        resampleImage(
          event.data.data,
          event.data.sourceWidth,
          event.data.sourceHeight,
          event.data.options.width,
          event.data.options.height,
          event.data.options.mode,
        ),
        event.data.options,
      ),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "图片转换失败",
    });
  }
};
