import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { topDialog, useFocusScope } from "../useFocusScope";
import { useLayerMotion } from "../useLayerMotion";
export default function GoalOverlay({
  title,
  kicker = "与对话保持同步",
  drawer = false,
  onClose,
  children,
}: {
  title: string;
  kicker?: string;
  drawer?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useFocusScope(true, panel);
  useLayerMotion(true, panel, drawer);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (topDialog() !== panel.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
    };
  }, []);
  return createPortal(
    <div
      className={`goal-overlay ${drawer ? "is-drawer" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="goal-overlay-panel"
        data-layer-motion
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header>
          <div>
            <span className="goal-kicker">{kicker}</span>
            <h2 style={{ overflowWrap: "anywhere" }}>{title}</h2>
          </div>
          <button
            className="gc-icon"
            aria-label={`关闭${title}`}
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
