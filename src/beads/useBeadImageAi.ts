import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ConvertOptions } from "./convert";
import type { ImageSource } from "./useImageImport";
import { useDraft } from "../drafts";

export interface SubjectResult {
  subject: string;
  features: string[];
  composition: string;
}
interface GeneratedResult {
  imageDataUrl: string;
  revisedPrompt: string;
}

export function encodeAiSource(source: ImageSource) {
  const scale = Math.min(
    1,
    1024 / Math.max(source.image.width, source.image.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.image.width * scale));
  canvas.height = Math.max(1, Math.round(source.image.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("无法准备 AI 图片");
  ctx.drawImage(source.image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export function useBeadImageAi(
  source: ImageSource | null,
  options: ConvertOptions,
) {
  const [phase, setPhase] = useState<"idle" | "analyzing" | "generating">(
    "idle",
  );
  const [error, setError] = useState("");
  const [subject, setSubject] = useState("");
  const [analysis, setAnalysis] = useState<SubjectResult | null>(null);
  const [instructions, setInstructions] = useState("");
  const [style, setStyle] = useState("flat"),
    [background, setBackground] = useState("plain");
  const modelDraft = useDraft<string>(
    "bead-image-model",
    () => "gpt-image-2.5-flare",
  );
  const imageModel =
    typeof modelDraft.value === "string"
      ? modelDraft.value
      : "gpt-image-2.5-flare";
  const setImageModel = modelDraft.set;
  const [prepared, setPrepared] = useState<ImageSource | null>(null);
  const [usePrepared, setUsePrepared] = useState(false);
  const [revisedPrompt, setRevisedPrompt] = useState("");
  const token = useRef(0),
    running = useRef(false),
    preparedRef = useRef(prepared);
  preparedRef.current = prepared;
  useEffect(() => {
    token.current++;
    running.current = false;
    preparedRef.current?.image.close();
    preparedRef.current = null;
    setPrepared(null);
    setUsePrepared(false);
    setAnalysis(null);
    setSubject("");
    setInstructions("");
    setError("");
    setPhase("idle");
    setRevisedPrompt("");
    return () => {
      token.current++;
      running.current = false;
    };
  }, [source]);
  useEffect(() => () => preparedRef.current?.image.close(), []);
  function cancel() {
    token.current++;
    running.current = false;
    setPhase("idle");
    setError(
      "已停止等待，不会采用迟到结果。服务端可能仍在处理并计费，请稍后再试。",
    );
  }
  async function run(kind: "analyzing" | "generating") {
    if (!source || running.current) return;
    if (!isTauri()) { setError("请在桌面应用中配置并使用 AI 服务"); return; }
    setError("");
    running.current = true;
    const request = ++token.current;
    setPhase(kind);
    try {
      const imageDataUrl = encodeAiSource(source);
      if (kind === "analyzing") {
        const result = await invoke<SubjectResult>("analyze_bead_image", { request: { imageDataUrl } });
        if (request !== token.current) return;
        if (
          !result.subject ||
          !Array.isArray(result.features) ||
          typeof result.composition !== "string"
        )
          throw Error("主体识别结果无效，请重试");
        setAnalysis(result);
        setSubject(
          [result.subject, ...result.features, result.composition]
            .join("\n")
            .slice(0, 3000),
        );
      } else {
        const requestBody = {
          imageDataUrl,
          subject,
          instructions,
          style,
          background,
          imageModel: imageModel.trim(),
          width: options.width,
          height: options.height,
          colors: options.colors,
        };
        const result = await invoke<GeneratedResult>("generate_bead_image", { request: requestBody });
        if (request !== token.current) return;
        if (!result.imageDataUrl?.startsWith("data:image/png;base64,"))
          throw Error("图片结果无效，请重试");
        const blob = await (await fetch(result.imageDataUrl)).blob();
        if (blob.size > 16 * 1024 * 1024)
          throw Error("生成图片超过 16 MB，请重试");
        const image = await createImageBitmap(blob);
        if (request !== token.current) {
          image.close();
          return;
        }
        if (image.width * image.height > 16_000_000) {
          image.close();
          throw Error("生成图片超过 1600 万像素");
        }
        preparedRef.current?.image.close();
        const next = {
          image,
          url: result.imageDataUrl,
          name: `${source.name} · AI 提炼`.slice(0, 80),
        };
        preparedRef.current = next;
        setPrepared(next);
        setRevisedPrompt(result.revisedPrompt || "");
        setUsePrepared(true);
      }
    } catch (e) {
      if (request === token.current)
        setError(
          String(e)
            .replace(/^Error: /, "")
            .replace(
              "ai_settings_missing",
              "尚未配置 AI，请在偏好设置填写共用 API_KEY 和 BASE_URL",
            ),
        );
    } finally {
      if (request === token.current) {
        running.current = false;
        setPhase("idle");
      }
    }
  }
  return {
    phase,
    busy: phase !== "idle",
    error: error || modelDraft.error,
    subject,
    setSubject,
    analysis,
    instructions,
    setInstructions,
    style,
    setStyle,
    background,
    setBackground,
    imageModel,
    setImageModel,
    prepared,
    usePrepared,
    setUsePrepared,
    revisedPrompt,
    analyze: () => run("analyzing"),
    generate: () => run("generating"),
    cancel,
  };
}
