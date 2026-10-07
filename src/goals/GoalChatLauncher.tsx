import { useEffect, useRef } from "react";
import { MessageCircle } from "lucide-react";
import "./conversation.css";
export default function GoalChatLauncher({
  name,
  onOpen,
}: {
  name: string;
  onOpen: () => void;
}) {
  const ref = useRef(onOpen);
  ref.current = onOpen;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        e.ctrlKey &&
        e.shiftKey &&
        e.code === "Space" &&
        !document.querySelector('[aria-modal="true"]')
      ) {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  return (
    <button
      className="goal-chat-launcher"
      title="与小汐对话（Ctrl + Shift + Space）"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onOpen}
    >
      <MessageCircle size={17} />
      <span>{name}</span>
    </button>
  );
}
