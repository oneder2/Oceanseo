import { useMemo, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { colorCode, counts } from "./beads/model";
import { useBeadDocument } from "./beads/useBeadDocument";
import BeadCanvas from "./beads/BeadCanvas";
import type { Tool } from "./beads/BeadCanvas";
import { can } from "./modules/capabilities";
import { findActiveWork, isLiveWork } from "./beads/works";
import "./beads/studio.css";

/** Lightweight Android continuation view: inspect a work and mark physical beads. */
export default function BeadMobileView() {
  const { state, works, activeWorkId, selectWork, toggleProgress, clearProgress, saveStatus, loadError } = useBeadDocument();
  const pattern = state.present;
  const [marking, setMarking] = useState(true);
  const [notice, setNotice] = useState("");
  const [gestureActive, setGestureActive] = useState(false);
  const [selectedColor, setSelectedColor] = useState<number | null>(null);
  const [boardSize, setBoardSize] = useState(29);
  const [board, setBoard] = useState("");
  const tally = useMemo(() => counts(pattern), [pattern]);
  const work = findActiveWork(works);
  const progress = work && (work.progressVersionId ?? work.currentVersionId) === work.currentVersionId ? work.completedCells : [];
  const occupied = pattern.cells.filter(cell => cell >= 0).length;
  const complete = progress.filter(index => pattern.cells[index] >= 0).length;
  const color = selectedColor !== null && tally[selectedColor] ? selectedColor : null;
  const columns = Math.ceil(pattern.width / boardSize), rows = Math.ceil(pattern.height / boardSize);
  const boardIndex = board === "" ? null : Number(board);
  const section = useMemo(() => {
    if (boardIndex === null || boardIndex >= columns * rows) return null;
    const x = (boardIndex % columns) * boardSize, y = Math.floor(boardIndex / columns) * boardSize;
    return { x, y, width: Math.min(boardSize, pattern.width - x), height: Math.min(boardSize, pattern.height - y) };
  }, [boardIndex, columns, rows, boardSize, pattern.width, pattern.height]);
  const selectedComplete = color === null ? complete : progress.filter(index => pattern.cells[index] === color).length;
  function openWork(id: string) { setSelectedColor(null); setBoard(""); selectWork(id); }
  const [tool, setTool] = useState<Tool>("pan");
  if (loadError) return <section className="bead-mobile-view" role="alert"><h1>作品暂时无法打开</h1><p>{loadError}</p></section>;
  if (!work) return <section className="bead-mobile-view"><h1>还没有进行中的作品</h1><p>在“我的作品”新建图纸，或恢复已归档、最近删除的作品，再继续拼放。</p></section>;
  return <section className="bead-mobile-view" aria-label="拼豆继续拼" aria-busy={gestureActive}>
    <header className="bead-mobile-head">
      <div><span className="eyebrow">作品继续拼</span><h1>{work.title}</h1><p>{pattern.width} × {pattern.height} 格 · {complete}/{occupied} 颗已完成</p></div>
      <label className="bead-mobile-select">作品<select aria-label="选择作品" value={activeWorkId} onChange={event => openWork(event.target.value)}>{works.works.filter(isLiveWork).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    </header>
    <div className="bead-mobile-progress" role="status"><span><strong>{occupied ? Math.round(complete / occupied * 100) : 0}%</strong> 完成</span><span>{tally.filter(Boolean).length} 种颜色</span><button type="button" disabled={!can("bead-studio", "write") || !complete} onClick={() => { clearProgress(); setNotice("已清除当前版本的拼放进度"); }}><RotateCcw size={16}/>清除进度</button></div>
    <div className="bead-mobile-tools" role="toolbar" aria-label="拼放工具">
      <button type="button" disabled={!can("bead-studio", "write")} aria-pressed={marking && can("bead-studio", "write")} onClick={() => setMarking(value => !value)}><Check size={17}/>{marking && can("bead-studio", "write") ? "标记模式" : "查看模式"}</button>
      <button type="button" aria-pressed={tool === "pan" && !marking} onClick={() => { setMarking(false); setTool("pan"); }}>拖动画布</button>
      <p>点按已完成的豆即可记录；再次点按可撤销。</p>
    </div>
    <details className="bead-mobile-locator">
      <summary>找豆与分板 <span>{color === null ? "全部颜色" : colorCode(color, pattern)} · {section ? `第 ${Number(board) + 1} 板` : "整张图纸"}</span></summary>
      <div className="bead-mobile-colors" role="group" aria-label="按颜色定位">
        <button type="button" aria-pressed={color === null} onClick={() => setSelectedColor(null)}>全部颜色</button>
        {tally.map((total, index) => total > 0 && <button type="button" key={index} aria-pressed={color === index} onClick={() => setSelectedColor(index)}
          aria-label={`定位 ${colorCode(index, pattern)} · ${pattern.palette[index].brand ?? pattern.palette[index].name} · ${total} 颗`}>
          <span className="bead-mobile-swatch" style={{ background: pattern.palette[index].hex }}/><span>{colorCode(index, pattern)}<small>{progress.filter(i => pattern.cells[i] === index).length}/{total} 颗</small></span>
        </button>)}
      </div>
      <div className="bead-mobile-boards">
        <label>每板格数<select aria-label="每板格数" value={boardSize} onChange={event => { setBoardSize(Number(event.target.value)); setBoard(""); }}><option value={29}>29 × 29</option><option value={50}>50 × 50</option></select></label>
        <label>查看区域<select aria-label="查看拼板" value={section ? board : ""} onChange={event => setBoard(event.target.value)}><option value="">整张图纸</option>{Array.from({ length: columns * rows }, (_, index) => <option value={index} key={index}>第 {index + 1} 板 · 行 {Math.floor(index / columns) + 1} 列 {index % columns + 1}</option>)}</select></label>
      </div>
      <p>紫色描边只用于定位，豆色保持原样。分板从左上角开始，不裁切图纸；格数请按实际拼板选择。</p>
    </details>
    {color !== null && <p className="bead-mobile-color-status" role="status"><span className="bead-mobile-swatch" style={{ background: pattern.palette[color].hex }}/>{colorCode(color, pattern)} · 已完成 {selectedComplete}/{tally[color]} 颗 · 紫边定位</p>}
    <div className="bead-mobile-canvas">
      <BeadCanvas pattern={pattern} tool={tool} color={0} labels contours locked={false} highlightColor={color} section={section} marking={marking && can("bead-studio", "write")} completedCells={progress} touch onCellTap={({ x, y }) => {
        const index = y * pattern.width + x;
        if (pattern.cells[index] < 0) { setNotice("空格不是拼放目标，请点按有颜色的豆。"); return; }
        if (section && (x < section.x || x >= section.x + section.width || y < section.y || y >= section.y + section.height)) { setNotice("请点按当前拼板区域内的豆，或切换到整张图纸。"); return; }
        if (color !== null && pattern.cells[index] !== color) { setNotice("正在逐色拼放，请点按紫边定位的豆，或切换到全部颜色。"); return; }
        toggleProgress(index);
        setNotice("");
      }} onCommit={() => undefined} onFill={() => undefined} onPick={() => undefined} onGesture={setGestureActive}/>
    </div>
    {notice && <p className="bead-mobile-notice" role="status">{notice}</p>}
    <footer className="bead-mobile-legend"><span>当前版本：{work.currentVersionId.slice(0, 8)}</span><span>{colorCode(0, pattern)} 起始色 · {tally[0] ?? 0} 颗</span><span role="status">{saveStatus}</span></footer>
  </section>;
}
