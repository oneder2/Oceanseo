import { useMemo } from "react";
import { colorCode, counts, type BeadPattern } from "./model";
import { materialKey } from "./works";

export default function MaterialPanel({
  pattern,
  inventory,
  updateInventory,
}: {
  pattern: BeadPattern;
  inventory: Record<string, number | null> | undefined;
  updateInventory: (key: string, amount: number | null) => boolean;
}) {
  const rows = useMemo(() => counts(pattern)
    .map((needed, index) => ({ color: pattern.palette[index], index, needed }))
    .filter(row => row.needed > 0), [pattern]);
  const known = rows.filter(row => inventory?.[materialKey(row.color)] !== undefined && inventory[materialKey(row.color)] !== null);
  const missing = rows.reduce((sum, row) => {
    const amount = inventory?.[materialKey(row.color)];
    return sum + (typeof amount === "number" ? Math.max(0, row.needed - amount) : 0);
  }, 0);
  return <div className="bead-panel-content bead-materials" aria-label="材料清单">
    <p className="bead-help">每个色号对应当前图纸用量。库存只保存在当前资料库；未填写表示数量未知，不会被当成充足。</p>
    <div className="bead-material-summary" role="status">
      <strong>{rows.length} 种颜色 · {missing} 颗已知缺料</strong>
      <span>{known.length}/{rows.length} 种已填写库存</span>
    </div>
    <div className="bead-material-list">
      {rows.map(({ color, index, needed }) => {
        const key = materialKey(color), amount = inventory?.[key];
        const deficit = typeof amount === "number" ? Math.max(0, needed - amount) : null;
        return <div className="bead-material-row" key={key}>
          <i style={{ background: color.hex }} aria-hidden="true" />
          <div className="bead-material-name"><strong>{colorCode(index, pattern)}</strong><span>{color.brand ?? color.name} · {color.hex.toUpperCase()}</span></div>
          <div className="bead-material-number"><label>需要 <b>{needed}</b></label><label>库存
            <input type="number" min="0" max="100000" step="1" inputMode="numeric" aria-label={`${colorCode(index, pattern)}库存`} placeholder="未知" value={amount ?? ""}
              onChange={event => { const raw = event.target.value.trim(); updateInventory(key, raw === "" ? null : Math.max(0, Math.min(100000, Math.floor(Number(raw))))); }} />
          </label></div>
          <small className={deficit === null ? "is-unknown" : deficit > 0 ? "is-missing" : "is-ready"}>{deficit === null ? "库存未知" : deficit > 0 ? `缺 ${deficit} 颗` : "已够用"}</small>
        </div>;
      })}
    </div>
    {!rows.length && <p className="bead-help">当前图纸还没有放置豆子，材料清单会在有颜色后出现。</p>}
    <p className="bead-help">库存不会静默扣减；完成作品或领用材料时，请在这里手动确认实际数量。</p>
  </div>;
}
