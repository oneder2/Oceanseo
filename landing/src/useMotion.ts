import { useEffect, type RefObject } from "react";

export function useMotion(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    void (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (disposed || !root.current) return;
      gsap.registerPlugin(ScrollTrigger);
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const context = gsap.context(() => {
          gsap.from(".hero-copy > *", {
            y: 16,
            duration: 0.65,
            stagger: 0.06,
            ease: "power2.out",
            clearProps: "transform",
          });
          gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
            gsap.from(el, {
              y: 22,
              duration: 0.65,
              ease: "power2.out",
              clearProps: "transform",
              scrollTrigger: { trigger: el, start: "top 92%", once: true },
            });
          });
        }, root);
        return () => context.revert();
      });
      cleanup = () => mm.revert();
      if (
        !matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)")
          .matches
      )
        return;
      const { default: Lenis } = await import("lenis");
      if (disposed) return;
      let destroyLenis = () => {};
      const scrollMedia = gsap.matchMedia();
      scrollMedia.add(
        "(min-width: 768px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
        () => {
          const lenis = new Lenis({
            duration: 0.85,
            anchors: true,
            prevent: (node) => !!node.closest("dialog"),
          });
          const tick = (time: number) => lenis.raf(time * 1000);
          lenis.on("scroll", ScrollTrigger.update);
          gsap.ticker.add(tick);
          const syncScroll = () =>
            document.hidden || document.querySelector("dialog[open]")
              ? lenis.stop()
              : lenis.start();
          const observer = new MutationObserver(syncScroll);
          observer.observe(document.body, {
            subtree: true,
            attributes: true,
            attributeFilter: ["open"],
          });
          document.addEventListener("visibilitychange", syncScroll);
          syncScroll();
          destroyLenis = () => {
            observer.disconnect();
            document.removeEventListener("visibilitychange", syncScroll);
            gsap.ticker.remove(tick);
            lenis.destroy();
          };
          return destroyLenis;
        },
      );
      cleanup = () => {
        scrollMedia.revert();
        mm.revert();
      };
    })().catch(() => {
      /* All content remains visible if animation loading fails. */
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [root]);
}
