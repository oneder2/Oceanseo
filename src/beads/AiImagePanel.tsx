import { useRef, useState } from "react";
import { ImagePlus, Sparkles, X, Download } from "lucide-react";
import type { useImageImport } from "./useImageImport";
import { exportSourceImage } from "./export";
import { isTauri } from "@tauri-apps/api/core";

export default function AiImagePanel({
  importer,
  disabled,
  onSettings,
}: {
  importer: ReturnType<typeof useImageImport>;
  disabled: boolean;
  onSettings: () => void;
}) {
  const { ai, source, options, setOptions } = importer;
  const dialog = useRef<HTMLDialogElement>(null);
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const locked = disabled || importer.busy;
  return (
    <section className="bead-ai" aria-label="AI 图像提炼">
      <header>
        <Sparkles size={18} />
        <div>
          <h3>先提炼主体，再转图纸</h3>
          <p>照片 → 简洁插画 → 拼豆</p>
        </div>
      </header>
      <p className="bead-help">
        点击识别或生成时，仅将这张图片和下方说明发送到你配置的 AI 服务，可能产生费用。上传前会缩至最长 1024 px 并移除原文件元数据。
      </p>
      <fieldset disabled={locked}>
        <button
          className="bead-action"
          disabled={!source}
          onClick={() => void ai.analyze()}
        >
          {ai.phase === "analyzing"
            ? "正在识别主体…"
            : ai.analysis
              ? "重新识别主体"
              : "1 · 识别图片主体"}
        </button>
        <label>
          主体与需保留的特征
          <textarea
            rows={5}
            maxLength={3000}
            value={ai.subject}
            placeholder="先识别主体，也可以自己描述：保留谁、姿态、表情或哪些景物…"
            onChange={(e) => ai.setSubject(e.target.value)}
          />
        </label>
        <div className="bead-fields">
          <label>
            图像风格
            <select
              value={ai.style}
              onChange={(e) => ai.setStyle(e.target.value)}
            >
              <option value="flat">平涂插画</option>
              <option value="pixel">像素插画</option>
              <option value="sticker">可爱贴纸</option>
            </select>
          </label>
          <label>
            背景处理
            <select
              value={ai.background}
              onChange={(e) => ai.setBackground(e.target.value)}
            >
              <option value="plain">纯色背景 · 突出主体</option>
              <option value="scene">保留主要景物</option>
            </select>
          </label>
        </div>
        <label>
          补充要求（选填）
          <textarea
            rows={2}
            maxLength={2000}
            value={ai.instructions}
            placeholder="例如：保留红围巾，去掉身后路人。"
            onChange={(e) => ai.setInstructions(e.target.value)}
          />
        </label>
        <details>
          <summary>图片模型与服务</summary>
          <label>
            图片生成模型
            <input
              value={ai.imageModel}
              maxLength={200}
              onChange={(e) => ai.setImageModel(e.target.value)}
            />
          </label>
          <p className="bead-help">
            {isTauri() ? "共用现有 API_KEY、BASE_URL 和对话模型；服务需额外支持 Responses 图片生成工具。图片模型可填写服务商提供的兼容名称。" : "请在桌面应用中配置并使用 AI 服务。"}
          </p>
          <button className="secondary-button" onClick={onSettings}>
            打开共用 AI 设置
          </button>
        </details>
        <p className="bead-help">
          按下方 {options.width} × {options.height} 格、最多 {options.colors}{" "}
          色的目标设计；最终豆色由本机色卡匹配。
        </p>
        <button
          className="bead-action"
          disabled={!source || !ai.subject.trim() || !ai.imageModel.trim()}
          onClick={() => {
            setOptions((o) => ({
              ...o,
              mode: "photo",
              cleanup: 2,
              boundaryCleanup: true,
            }));
            void ai.generate();
          }}
        >
          <ImagePlus size={16} />
          {ai.phase === "generating"
            ? "正在生成适拼插画…"
            : ai.prepared
              ? "重新生成插画"
              : "2 · 生成适拼插画"}
        </button>
      </fieldset>
      {ai.busy && (
        <p role="status">
          {ai.phase === "analyzing"
            ? "正在理解图片中的主体和构图…"
            : "正在重新绘制主体，通常需要稍等片刻…"}
        </p>
      )}
      {ai.error && (
        <div className="bead-ai-error" role="alert">
          {ai.error}
          <button className="secondary-button" onClick={onSettings}>
            检查共用 AI 配置
          </button>
        </div>
      )}
      {ai.prepared && (
        <div className="bead-ai-result">
          <button
            className="bead-ai-image"
            onClick={() => dialog.current?.showModal()}
            aria-label="对比原图与 AI 插画"
          >
            <img src={ai.prepared.url} alt="AI 生成的适拼插画" />
            <span>点击放大 · 对比原图</span>
          </button>
          <label className="bead-check">
            <input
              type="checkbox"
              checked={ai.usePrepared}
              disabled={locked}
              onChange={(e) => {
                ai.setUsePrepared(e.target.checked);
                if (e.target.checked)
                  setOptions((o) => ({ ...o, mode: "photo" }));
              }}
            />
            使用这张插画生成图纸
          </label>
          <p className="bead-help">
            当前转换来源：{ai.usePrepared ? "AI 插画" : "导入原图"}
            。调整下方网格后预览，当前图纸尚未更改。重新生成失败时会保留这张结果。离开页面前可保存插画
            PNG；应用的图纸会自动保存。
          </p>
          <button
            className="secondary-button"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              setExportError("");
              try {
                await exportSourceImage(ai.prepared!.url, ai.prepared!.name);
              } catch (e) {
                setExportError(String(e));
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download size={15} />
            保存插画 PNG
          </button>
          {exportError && <p role="alert">{exportError}</p>}
          <dialog
            ref={dialog}
            aria-modal="true"
            aria-label="原图与适拼插画"
            className="bead-ai-dialog"
            onClick={(e) => {
              if (e.target === e.currentTarget) dialog.current?.close();
            }}
          >
            <header>
              <div>
                <small>生成结果预览</small>
                <h2>原图与适拼插画</h2>
              </div>
              <button
                aria-label="关闭图像对比"
                onClick={() => dialog.current?.close()}
              >
                <X />
              </button>
            </header>
            <div>
              {[
                { label: "原图", url: source?.url },
                { label: "AI 插画", url: ai.prepared.url },
              ].map((item) => (
                <figure key={item.label}>
                  <img src={item.url} alt={item.label} />
                  <figcaption>{item.label}</figcaption>
                </figure>
              ))}
            </div>
            <p>
              生成结果可能简化细节。确认主体后，在导入面板生成拼豆预览；应用后仍可撤销。
            </p>
          </dialog>
        </div>
      )}
    </section>
  );
}
