import { useState } from "react";
import { colorCode, type BeadPattern } from "./model";
import { fillHoles, thickenOutline } from "./edit";
import type { Proposal } from "./document";

export default function ShapePanel({
  pattern,
  color,
  propose,
  notify,
}: {
  pattern: BeadPattern;
  color: number;
  propose: (p: Proposal) => void;
  notify: (message: string) => void;
}) {
  const [layers, setLayers] = useState(1),
    [expand, setExpand] = useState(true);
  const empty = !pattern.cells.some((c) => c >= 0);
  return (
    <div className="bead-panel-content">
      <div className="bead-current-color">
        <i style={{ background: pattern.palette[color].hex }} />
        使用 {colorCode(color, pattern)} · {pattern.palette[color].name}
      </div>
      <h3>封闭空洞</h3>
      <p className="bead-help">
        填满轮廓内部的透明格，保留外部空白。只填一处时，选择工具栏的「区域填充」。
      </p>
      <button
        className="bead-action"
        disabled={empty}
        onClick={() =>
          propose({
            label: "填充空心",
            after: fillHoles(pattern, color),
            message: `使用 ${colorCode(color, pattern)} 填充所有封闭空洞。上下左右与画布边缘相通的空白会保留。`,
          })
        }
      >
        填充所有空心
      </button>
      <h3>外轮廓加厚</h3>
      <label>
        加边厚度（格）
        <input
          type="number"
          min={1}
          max={8}
          value={layers}
          onChange={(e) => setLayers(Number(e.target.value))}
        />
      </label>
      <label className="bead-check">
        <input
          type="checkbox"
          checked={expand}
          onChange={(e) => setExpand(e.target.checked)}
        />
        触边时自动扩展画布
      </label>
      <p className="bead-help">
        向外增加豆子（包含斜角），保留原色和内孔。
        {expand
          ? "扩展会相应调整坐标，最大 160×160 格。"
          : "触边处受当前画布限制，无法继续加厚。"}
      </p>
      <button
        className="bead-action"
        disabled={
          empty || !Number.isInteger(layers) || layers < 1 || layers > 8
        }
        onClick={() => {
          try {
            propose({
              label: "轮廓加厚",
              after: thickenOutline(pattern, color, layers, expand),
              message: `使用 ${colorCode(color, pattern)} 向外增加 ${layers} 层。${expand ? "触边处自动扩展，原图案坐标可能整体平移。" : "仅在现有画布内增加。"}原有豆和内孔保持不变。`,
            });
          } catch (e) {
            notify(e instanceof Error ? e.message : "加边失败");
          }
        }}
      >
        预览轮廓加厚
      </button>
      <p className="bead-help">批量修改均先预览，再应用。应用后可整体撤销。</p>
    </div>
  );
}
