import { useRef } from "react";
import { validSize } from "./model";
import type { useImageImport } from "./useImageImport";

export default function ImportPanel({
  importer,
  disabled,
}: {
  importer: ReturnType<typeof useImageImport>;
  disabled: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const { source, options, setOptions, busy } = importer;
  return (
    <div className="bead-panel-content">
      <p className="bead-help">
        图片在本机处理。原图不会被修改，应用导入结果后可撤销。
      </p>
      <input
        ref={file}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp"
        onChange={(e) => {
          void importer.select(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        className="bead-action"
        disabled={disabled || busy}
        onClick={() => file.current?.click()}
      >
        选择图片
      </button>
      {source && (
        <figure className="bead-source">
          <img src={source.url} alt="导入原图" />
          <figcaption>
            {source.image.width} × {source.image.height} px · {source.name}
          </figcaption>
        </figure>
      )}
      <fieldset disabled={disabled || busy}>
        <label>
          导入模式
          <select
            value={options.mode}
            onChange={(e) => {
              const mode = e.target.value as "photo" | "pixel";
              setOptions((o) => ({
                ...o,
                mode,
                ...(mode === "pixel" &&
                source &&
                source.image.width <= 160 &&
                source.image.height <= 160
                  ? { width: source.image.width, height: source.image.height }
                  : {}),
              }));
            }}
          >
            <option value="photo">照片转图 · 精简配色</option>
            <option value="pixel">像素原稿 · 保留原色</option>
          </select>
        </label>
        <div className="bead-fields">
          <label>
            解析宽度
            <input
              type="number"
              min={1}
              max={160}
              value={options.width}
              onChange={(e) =>
                importer.dimension("width", Number(e.target.value))
              }
            />
          </label>
          <label>
            解析高度
            <input
              type="number"
              min={1}
              max={160}
              value={options.height}
              onChange={(e) =>
                importer.dimension("height", Number(e.target.value))
              }
            />
          </label>
        </div>
        <label className="bead-check">
          <input
            type="checkbox"
            checked={importer.lockRatio}
            onChange={(e) => importer.setLockRatio(e.target.checked)}
          />
          联动宽高比例
        </label>
        {options.mode === "photo" ? (
          <>
            <label>
              最多颜色数
              <input
                type="number"
                min={2}
                max={48}
                value={options.colors}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    colors: Math.max(2, Math.min(48, Number(e.target.value))),
                  }))
                }
              />
            </label>
            <label>
              去杂色强度
              <select
                value={options.cleanup}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, cleanup: Number(e.target.value) }))
                }
              >
                <option value={0}>关闭 · 保留细节</option>
                <option value={1}>温和 · 保留轮廓</option>
                <option value={2}>较强 · 简化色块</option>
              </select>
            </label>
          </>
        ) : (
          <p className="bead-help">
            每个像素对应一颗豆。放大过的像素画需填写原始格数；透明处留空，不识别图片中的网格和文字。
          </p>
        )}
        <button
          className="bead-action"
          disabled={
            !source || !validSize(options.width) || !validSize(options.height)
          }
          onClick={importer.convert}
        >
          生成图纸预览
        </button>
      </fieldset>
      {busy && (
        <button className="secondary-button" onClick={importer.cancel}>
          取消图片处理
        </button>
      )}
    </div>
  );
}
