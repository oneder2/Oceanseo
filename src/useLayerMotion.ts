import { useEffect, type RefObject } from "react";

// Load motion only for an open layer; content and focus never wait for GSAP.
export function useLayerMotion(active: boolean, ref: RefObject<HTMLElement | null>, drawer = false) {
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches || document.hidden) return;
    let disposed = false;
    let revert: (() => void) | undefined;
    const openedAt = performance.now();
    const stop = () => { disposed = true; revert?.(); };
    const onVisibility = () => { if (document.hidden) stop(); };
    reduced.addEventListener("change", stop);
    document.addEventListener("visibilitychange", onVisibility);
    void import("gsap").then(({ gsap }) => {
      if (disposed || reduced.matches || document.hidden || !element.isConnected || performance.now() - openedAt > 150) return;
      const context = gsap.context(() => {
        gsap.fromTo(element, { x: drawer ? 16 : 0, y: drawer ? 0 : 6 }, {
          x: 0, y: 0, duration: .18, ease: "power2.out", clearProps: "transform",
        });
      }, element);
      revert = () => context.revert();
    }).catch(() => { /* Static layers remain usable if the motion chunk fails. */ });
    return () => {
      stop();
      reduced.removeEventListener("change", stop);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, ref, drawer]);
}
