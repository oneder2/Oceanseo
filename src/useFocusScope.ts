import { useLayoutEffect, type RefObject } from "react";

const controls = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]';

export function topDialog() {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')]
    .filter(element => !element.closest("[inert]") && element.getClientRects().length > 0)
    .at(-1);
}

// Portal date pickers and nested dialogs own focus until they close.
export function useFocusScope(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
  initialSelector = "[data-dialog-initial]",
) {
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!active || !panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const enabled = () => [...panel.querySelectorAll<HTMLElement>(controls)]
      .filter(element => !element.closest("[inert]") && element.getClientRects().length > 0);
    const initial = panel.querySelector<HTMLElement>(initialSelector) ?? enabled()[0] ?? panel;
    initial.focus({ preventScroll: true });

    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || topDialog() !== panel) return;
      const items = enabled();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (!panel.contains(document.activeElement) ||
        (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) ||
        (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      requestAnimationFrame(() => {
        const current = document.activeElement;
        if (current !== document.body && current !== previous && !panel.contains(current)) return;
        if (previous?.isConnected && !previous.closest("[inert]") && previous.getClientRects().length) {
          previous.focus({ preventScroll: true });
        }
      });
    };
  }, [active, ref, initialSelector]);
}
