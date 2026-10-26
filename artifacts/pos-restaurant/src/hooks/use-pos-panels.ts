import { useEffect, type RefObject } from "react";

/** Presentation only: never sends orders or invokes payment handlers. */
export function usePosPanels(
  rootRef: RefObject<HTMLDivElement | null>,
  moreOpen: boolean,
  closeMore: () => void,
) {
  useEffect(() => {
    if (!moreOpen) return;
    const root = rootRef.current;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest(".pos-more-wrap")) closeMore();
    };
    const onKey = (event: KeyboardEvent) => {
      // Portalled dialogs own their Escape key and must keep their focus.
      if (event.key === "Escape" && root?.contains(document.activeElement)) {
        event.preventDefault();
        closeMore();
        root.querySelector<HTMLElement>(".pos-more-toggle")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [rootRef, moreOpen, closeMore]);
}
