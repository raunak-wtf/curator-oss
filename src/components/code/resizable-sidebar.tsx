"use client";

import { type ReactNode, useRef, useSyncExternalStore } from "react";

/** The sidebar can grow from its default width up to 1.5 times that width. */
const MIN_SCALE = 1;
const MAX_SCALE = 1.5;
const KEY_STEP = 0.05;

// Width is stored as a scale of the default (224 px, or 168 px on narrow screens), so it
// stays within limits when the default changes between breakpoints.
const listeners = new Set<() => void>();
const memory = new Map<string, number>();

function clamp(scale: number) {
  const bounded = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(scale) ? scale : MIN_SCALE));
  return Math.round(bounded * 1000) / 1000;
}

function readScale(key: string) {
  if (memory.has(key)) return memory.get(key)!;
  let scale = MIN_SCALE;
  try {
    scale = clamp(Number(window.localStorage.getItem(key) ?? MIN_SCALE));
  } catch {
    // Blocked storage: use the default width.
  }
  memory.set(key, scale);
  return scale;
}

function writeScale(key: string, scale: number, persist: boolean) {
  memory.set(key, clamp(scale));
  if (persist) {
    try {
      window.localStorage.setItem(key, String(memory.get(key)));
    } catch {
      // Blocked storage: the width still applies for this session.
    }
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type ResizableSidebarProps = {
  /** localStorage key for the chosen width. */
  storageKey: string;
  className: string;
  "aria-label": string;
  /** Name of the resize handle for screen readers. */
  handleLabel: string;
  children: ReactNode;
};

/** A left sidebar with a drag handle on its right edge. Also resizable with the arrow keys; double-click resets it. */
export function ResizableSidebar({ storageKey, className, handleLabel, children, ...rest }: ResizableSidebarProps) {
  const scale = useSyncExternalStore(
    subscribe,
    () => readScale(storageKey),
    () => MIN_SCALE,
  );
  const asideRef = useRef<HTMLElement>(null);
  const drag = useRef<{ startX: number; startWidth: number; base: number } | null>(null);
  const percent = Math.round(scale * 100);

  return (
    <aside
      ref={asideRef}
      className={className}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: `calc(var(--sidebar-base, 224px) * ${scale})`,
        flex: "0 0 auto",
      }}
      {...rest}
    >
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={handleLabel}
        aria-valuemin={MIN_SCALE * 100}
        aria-valuemax={MAX_SCALE * 100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% of the default width`}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        className="sidebar-resize-handle"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const startWidth = asideRef.current?.getBoundingClientRect().width ?? 0;
          drag.current = { startX: event.clientX, startWidth, base: startWidth / scale || 224 };
          document.body.classList.add("is-resizing-sidebar");
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          writeScale(storageKey, (current.startWidth + event.clientX - current.startX) / current.base, false);
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          document.body.classList.remove("is-resizing-sidebar");
          writeScale(storageKey, readScale(storageKey), true);
        }}
        onPointerCancel={() => {
          drag.current = null;
          document.body.classList.remove("is-resizing-sidebar");
        }}
        onDoubleClick={() => writeScale(storageKey, MIN_SCALE, true)}
        onKeyDown={(event) => {
          const next =
            event.key === "ArrowRight" ? scale + KEY_STEP
              : event.key === "ArrowLeft" ? scale - KEY_STEP
                : event.key === "Home" ? MIN_SCALE
                  : event.key === "End" ? MAX_SCALE
                    : null;
          if (next === null) return;
          event.preventDefault();
          writeScale(storageKey, next, true);
        }}
      />
    </aside>
  );
}
