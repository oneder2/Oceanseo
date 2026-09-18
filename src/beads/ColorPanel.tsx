import { useEffect, useState } from "react";
import { colorCode, MAX_COLORS, type BeadPattern } from "./model";
import ColorLocator from "./ColorLocator";
import {
  BRANDS,
  PALETTE_NOTICE,
  PALETTE_SOURCE,
  brandPalette,
  editColor,
  mapPatternToBrand,
  paletteDescription,
  type BeadBrand,
} from "./palettes";
import type { Proposal } from "./document";

export default function ColorPanel({
  pattern,
  color,
  tally,
  select,
  commit,
  paint,
  propose,
}: {
  pattern: BeadPattern;
  color: number;
  tally: number[];
  select: (color: number) => void;
  commit: (label: string, after: BeadPattern) => void;
  paint: () => void;
  propose: (proposal: Proposal) => void;
}) {
  const [search, setSearch] = useState(""),
    [onlyUsed, setOnlyUsed] = useState(false),
    [locate, setLocate] = useState(true);
  const active = pattern.palette[color];
  const [brand, setBrand] = useState<BeadBrand>(active.brand ?? "MARD");
  const [catalogCode, setCatalogCode] = useState(brandPalette(brand)[0].code!);
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
        `${colorCode(c.i, pattern)} ${c.name} ${c.hex}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  function update(key: "name" | "hex", value: string) {
    commit(key === "name" ? "重命名豆色" : "修改豆色", {
      ...pattern,
      palette: pattern.palette.map((c, i) =>
        i === color ? editColor(c, key, value) : c,
      ),
    });
  }
  return (
    <div className="bead-panel-content">
      <p className="bead-help">{paletteDescription(pattern)}</p>
      <details>
        <summary>品牌色卡与配色转换</summary>
        <label>
          目标品牌
          <select
            value={brand}
            onChange={(e) => {
              const next = e.target.value as BeadBrand;
              setBrand(next);
              setCatalogCode(brandPalette(next)[0].code!);
            }}
          >
            {BRANDS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <p className="bead-help">{PALETTE_NOTICE}</p>
        <p className="bead-help">
          <a href={PALETTE_SOURCE} target="_blank" rel="noreferrer">
            色表来源与版本
          </a>{" "}
          ·{" "}
          <a
            href="/licenses/bead-palettes-Apache-2.0.txt"
            target="_blank"
            rel="noreferrer"
          >
            Apache 2.0 许可
          </a>
        </p>
        <button
          className="bead-action"
          onClick={() =>
            propose({
              label: `转换为 ${brand} 色卡`,
              message:
                "按近似色重新匹配整张图纸，合并重复色并移除未使用颜色。请先检查预览，应用后可撤销。",
              after: mapPatternToBrand(pattern, brand),
            })
          }
        >
          预览全图品牌配色
        </button>
        <label>
          添加厂家豆色
          <select
            value={catalogCode}
            onChange={(e) => setCatalogCode(e.target.value)}
          >
            {brandPalette(brand).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.hex.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          disabled={pattern.palette.length >= MAX_COLORS}
          onClick={() => {
            const c = brandPalette(brand).find((c) => c.code === catalogCode)!;
            const found = pattern.palette.findIndex(
              (v) => v.brand === brand && v.code === c.code,
            );
            if (found >= 0) select(found);
            else {
              commit("添加厂家豆色", {
                ...pattern,
                palette: [...pattern.palette, c],
              });
              select(pattern.palette.length);
            }
            setOnlyUsed(false);
            setSearch("");
          }}
        >
          添加或选择此色号
        </button>
      </details>
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
            aria-label={`选择 ${colorCode(c.i, pattern)} ${c.name}`}
            aria-pressed={color === c.i}
            onClick={() => {
              select(c.i);
              setLocate(true);
            }}
          >
            <i style={{ background: c.hex }} />
            <span>
              <strong>{colorCode(c.i, pattern)}</strong>
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
        用 {colorCode(color, pattern)} 绘制
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
          修改会影响所有同色豆子，可撤销。修改厂家颜色的 RGB
          后将转为自定义颜色，取消厂家色号。B 编号仅用于无品牌图纸，混合配色用 U
          编号区分自定义色。
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
