import { useEffect, useState } from "react";
import { colorCode, MAX_COLORS, type BeadPattern } from "./model";
import ColorLocator from "./ColorLocator";

export default function ColorPanel({
  pattern,
  color,
  tally,
  select,
  commit,
  paint,
}: {
  pattern: BeadPattern;
  color: number;
  tally: number[];
  select: (color: number) => void;
  commit: (label: string, after: BeadPattern) => void;
  paint: () => void;
}) {
  const [search, setSearch] = useState(""),
    [onlyUsed, setOnlyUsed] = useState(false),
    [locate, setLocate] = useState(true);
  const active = pattern.palette[color];
  const [name, setName] = useState(active.name),
    [hex, setHex] = useState(active.hex);
  useEffect(() => {
    setName(active.name);
    setHex(active.hex);
  }, [color, active.name, active.hex]);
  const colors = pattern.palette
    .map((c, i) => ({ ...c, i }))
    .filter(
      (c) =>
        (!onlyUsed || tally[c.i]) &&
        `${colorCode(c.i)} ${c.name} ${c.hex}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  function update(key: "name" | "hex", value: string) {
    commit(key === "name" ? "重命名豆色" : "修改豆色", {
      ...pattern,
      palette: pattern.palette.map((c, i) =>
        i === color ? { ...c, [key]: value } : c,
      ),
    });
  }
  return (
    <div className="bead-panel-content">
      <label>
        查找豆色
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="色号、名称或 HEX"
        />
      </label>
      <label className="bead-check">
        <input
          type="checkbox"
          checked={onlyUsed}
          onChange={(e) => setOnlyUsed(e.target.checked)}
        />
        只看已使用的颜色
      </label>
      <div className="bead-palette-list">
        {colors.map((c) => (
          <button
            key={c.i}
            aria-label={`选择 ${colorCode(c.i)} ${c.name}`}
            aria-pressed={color === c.i}
            onClick={() => {
              select(c.i);
              setLocate(true);
            }}
          >
            <i style={{ background: c.hex }} />
            <span>
              <strong>{colorCode(c.i)}</strong>
              <small>{c.name}</small>
            </span>
            <em>{tally[c.i]} 颗</em>
          </button>
        ))}
        {!colors.length && (
          <p className="bead-help">没有匹配颜色，请调整搜索或筛选。</p>
        )}
      </div>
      <button className="bead-action" onClick={paint}>
        用 {colorCode(color)} 绘制
      </button>
      <p className="bead-help">
        选色只更新当前色；开始绘制请点击上方按钮或选择画笔。
      </p>
      <label className="bead-check">
        <input
          type="checkbox"
          checked={locate}
          onChange={(e) => setLocate(e.target.checked)}
        />
        同色定位图
      </label>
      {locate && (
        <ColorLocator pattern={pattern} color={color} count={tally[color]} />
      )}
      <details>
        <summary>编辑当前豆色</summary>
        <label>
          当前色名称
          <input
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => update("name", name)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </label>
        <label>
          当前色值
          <input
            type="color"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            onBlur={() => update("hex", hex)}
          />
        </label>
        <p className="bead-help">
          修改名称或色值会同步影响所有同色号的豆子，可撤销。B 编号为本图纸编号。
        </p>
      </details>
      <button
        className="secondary-button"
        disabled={pattern.palette.length >= MAX_COLORS}
        onClick={() => {
          commit("添加豆色", {
            ...pattern,
            palette: [...pattern.palette, { hex: "#8b7fa3", name: "新颜色" }],
          });
          select(pattern.palette.length);
          setOnlyUsed(false);
          setSearch("");
        }}
      >
        添加颜色
      </button>
    </div>
  );
}
