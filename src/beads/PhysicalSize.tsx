import { useEffect, useState } from "react";
import { formatCm, physicalSize, validPitch, type BeadPattern } from "./model";

export default function PhysicalSize({
  pattern,
  onChange,
}: {
  pattern: BeadPattern;
  onChange: (pitch: number) => void;
}) {
  const size = physicalSize(pattern);
  const [input, setInput] = useState(String(size.pitch));
  const [custom, setCustom] = useState(![5, 2.6].includes(size.pitch));
  const [error, setError] = useState("");
  useEffect(() => {
    setInput(String(size.pitch));
    setCustom(![5, 2.6].includes(size.pitch));
    setError("");
  }, [size.pitch]);
  function apply() {
    const pitch = Number(input);
    if (!validPitch(pitch)) {
      setError("请输入 0.5–20 mm 的豆距");
      return;
    }
    setError("");
    onChange(pitch);
  }
  return (
    <section className="bead-measure" aria-label="实际尺寸换算">
      <h2>
        实际尺寸 <small>熨烫前估算</small>
      </h2>
      <label>
        豆距 / 规格
        <select
          value={custom ? "custom" : String(size.pitch)}
          onChange={(e) => {
            if (e.target.value === "custom") setCustom(true);
            else {
              setCustom(false);
              setError("");
              onChange(Number(e.target.value));
            }
          }}
        >
          <option value="5">标准豆 · 5 mm</option>
          <option value="2.6">迷你豆 · 2.6 mm</option>
          <option value="custom">自定义豆距</option>
        </select>
      </label>
      {custom && (
        <label>
          豆距（mm）
          <input
            type="number"
            min="0.5"
            max="20"
            step="0.1"
            value={input}
            aria-invalid={!!error}
            onChange={(e) => setInput(e.target.value)}
            onBlur={apply}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                apply();
              }
            }}
          />
        </label>
      )}
      {error && (
        <p className="bead-error" role="alert">
          {error}
        </p>
      )}
      <dl>
        <div>
          <dt>图案占用</dt>
          <dd>
            {size.artwork
              ? `${formatCm(size.artwork.width)} × ${formatCm(size.artwork.height)} cm`
              : "还没有放豆"}
          </dd>
        </div>
        <div>
          <dt>整张画布</dt>
          <dd>
            {formatCm(size.canvas.width)} × {formatCm(size.canvas.height)} cm
          </dd>
        </div>
      </dl>
      <p className="bead-help">
        按格数 ×
        豆距换算。图案尺寸不含外围空白；熨烫、品牌和底板间距会带来差异。屏幕缩放不是实物
        1:1。
      </p>
    </section>
  );
}
