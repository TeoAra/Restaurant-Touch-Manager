import { useEffect, type RefObject } from "react";

/** Presentation only: never sends orders or invokes payment handlers. */
export function usePosPanels(
  rootRef: RefObject<HTMLDivElement | null>,
  tablesOpen: boolean,
  closeTables: () => void,
  moreOpen: boolean,
  closeMore: () => void,
) {
  useEffect(() => {
    if (!tablesOpen) return;
    const root = rootRef.current;
    const drawer = root?.querySelector<HTMLElement>("#pos-tables");
    if (!root || !drawer) return;
    const mobile = window.matchMedia("(max-width: 760px)");
    const previousFocus = document.activeElement as HTMLElement | null;
    const inertElements: HTMLElement[] = [];
    const focusable = () => Array.from(drawer.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input, select, [tabindex="0"]',
    )).filter(el => el.getClientRects().length > 0);
    const restore = () => {
      inertElements.forEach(el => { el.inert = false; });
      inertElements.length = 0;
      drawer.removeAttribute("role");
      drawer.removeAttribute("aria-modal");
    };
    const sync = () => {
      restore();
      if (!mobile.matches) return;
      drawer.setAttribute("role", "dialog");
      drawer.setAttribute("aria-modal", "true");
      for (const child of Array.from(root.children)) {
        if (child instanceof HTMLElement && child !== drawer && !child.classList.contains("pos-table-scrim") && !child.inert) {
          child.inert = true;
          inertElements.push(child);
        }
      }
      focusable()[0]?.focus({ preventScroll: true });
    };
    const onKey = (event: KeyboardEvent) => {
      if (!mobile.matches) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeTables();
      }
      if (event.key === "Tab") {
        const elements = focusable();
        const index = elements.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey ? index <= 0 : index === -1 || index === elements.length - 1) {
          event.preventDefault();
          elements[event.shiftKey ? elements.length - 1 : 0]?.focus();
        }
      }
    };
    sync();
    mobile.addEventListener("change", sync);
    document.addEventListener("keydown", onKey);
    return () => {
      restore();
      mobile.removeEventListener("change", sync);
      document.removeEventListener("keydown", onKey);
      // Do not steal focus from a covers dialog opened by selecting a table.
      if (drawer.contains(document.activeElement) || document.activeElement === document.body) {
        previousFocus?.focus({ preventScroll: true });
      }
    };
  }, [rootRef, tablesOpen, closeTables]);

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
