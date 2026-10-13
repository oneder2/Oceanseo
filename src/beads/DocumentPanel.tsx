import { useEffect, useState } from "react";
import {
  blankPattern,
  resizePattern,
  validSize,
  type BeadPattern,
} from "./model";
import type { Proposal } from "./document";
import PhysicalSize from "./PhysicalSize";

export default function DocumentPanel({
  pattern,
  propose,
  commit,
}: {
  pattern: BeadPattern;
  propose: (proposal: Proposal) => void;
  commit: (label: string, after: BeadPattern) => void;
}) {
  const [width, setWidth] = useState(pattern.width),
    [height, setHeight] = useState(pattern.height),
    [scale, setScale] = useState(false);
  useEffect(() => {
    setWidth(pattern.width);
    setHeight(pattern.height);
  }, [pattern.width, pattern.height]);
  return (
    <div className="bead-panel-content">
      <h3>画布网格</h3>
      <div className="bead-fields">
        <label>
          画布宽度
          <input
            type="number"
            min={1}
            max={160}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <label>
          画布高度
          <input
            type="number"
            min={1}
            max={160}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </label>
      </div>
      <label className="bead-check">
        <input
          type="checkbox"
          checked={scale}
          onChange={(e) => setScale(e.target.checked)}
        />
        同时缩放内容（最近邻）
      </label>
      <p className="bead-help">
        关闭缩放时保留左上角；扩展留空，缩小会裁去越界部分。
      </p>
      <button
        className="bead-action"
        disabled={!validSize(width) || !validSize(height)}
        onClick={() =>
          propose({
            label: "调整尺寸",
            after: resizePattern(pattern, width, height, scale),
            message: scale
              ? "按新网格尺寸缩放图案，可撤销。"
              : "保留左上角，裁去越界内容；新增格子留空，可撤销。",
          })
        }
      >
        预览尺寸调整
      </button>
      <PhysicalSize
        pattern={pattern}
        onChange={(pitch) =>
          commit("更改豆距", { ...pattern, beadPitchMm: pitch })
        }
      />
      <h3>新建图纸</h3>
      <p className="bead-help">
        此处清空当前作品的图纸，保留作品身份。另存一件独立作品，请使用上方“新建作品”。
      </p>
      <button
        className="secondary-button"
        onClick={() =>
          propose({
            label: "新建图纸",
            after: { ...blankPattern(), beadPitchMm: pattern.beadPitchMm },
            message: "用新的 29×29 空白图纸替换当前内容，沿用当前豆距。",
          })
        }
      >
        新建空白图纸
      </button>
    </div>
  );
}
