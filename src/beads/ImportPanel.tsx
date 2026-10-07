import { useRef, useState } from "react";
import AiImagePanel from "./AiImagePanel";
import { validSize } from "./model";
import { BRANDS, PALETTE_NOTICE, type BeadBrand } from "./palettes";
import type { useImageImport } from "./useImageImport";

export default function ImportPanel({
  importer,
  disabled,
  onSettings,
}: {
  importer: ReturnType<typeof useImageImport>;
  disabled: boolean;
  onSettings: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState<"local" | "ai">("local");
  const { source, options, setOptions, busy } = importer;
  return (
    <div className="bead-panel-content">
      <p className="bead-help">
        本机转图适合已有插画；真实人物或风景可先用 AI
        提炼主体。应用前可预览，原图不变。
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
      <div
        className="bead-import-method"
        role="group"
        aria-label="图像转换方式"
      >
        <button
          aria-pressed={method === "local"}
          disabled={disabled || busy}
          onClick={() => {
            setMethod("local");
            importer.ai.setUsePrepared(false);
          }}
        >
          本机转图
        </button>
        <button
          aria-pressed={method === "ai"}
          disabled={disabled || busy}
          onClick={() => setMethod("ai")}
        >
          AI 提炼主体
        </button>
      </div>
      <div hidden={method !== "ai"}>
        <AiImagePanel
          importer={importer}
          disabled={disabled}
          onSettings={onSettings}
        />
      </div>
      <h3>{method === "ai" ? "3 · 转为拼豆图纸" : "网格与配色"}</h3>
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
            <option value="pixel">像素原稿 · 保留像素结构</option>
          </select>
        </label>
        <label>
          拼豆品牌
          <select
            value={options.brand ?? "custom"}
            onChange={(e) =>
              setOptions((o) => ({
                ...o,
                brand: e.target.value as BeadBrand | "custom",
              }))
            }
          >
            {BRANDS.map((brand) => (
              <option key={brand} value={brand}>
                {brand} · 221 色
              </option>
            ))}
            <option value="custom">自定义原色 · 非厂家色号</option>
          </select>
        </label>
        <p className="bead-help">
          {options.brand && options.brand !== "custom"
            ? PALETTE_NOTICE
            : "保留图片配色，使用图纸内部 B 编号。"}
        </p>
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
            <label className="bead-check">
              <input
                type="checkbox"
                checked={options.boundaryCleanup !== false}
                disabled={!options.cleanup}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    boundaryCleanup: e.target.checked,
                  }))
                }
              />
              交界净化 · 清理混色线与小杂点
            </label>
            <p className="bead-help">
              在缩图和最终豆色分配后处理交界，保留深色轮廓与高光。较强模式也会精简微小有色装饰，可关闭净化对比。
            </p>
          </>
        ) : (
          <p className="bead-help">
            每个像素对应一颗豆，不做降噪。选择品牌后会匹配该品牌近似色；选择自定义原色可保留原始
            RGB。放大过的像素画需填写原始格数；透明处留空，不识别网格和文字。
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
