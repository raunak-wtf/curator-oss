"use client";

import { Check, ChevronUp, Compass, Hammer } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { BuildChatMode } from "@/lib/types";
import { cn } from "@/lib/utils";

const OPTIONS: { value: BuildChatMode; label: string; description: string; icon: typeof Hammer }[] = [
  {
    value: "build",
    label: "Build",
    description: "Edits files, runs checks, and updates the live preview.",
    icon: Hammer,
  },
  {
    value: "plan",
    label: "Plan",
    description: "Read-only: inspects code, answers questions, and writes a plan.",
    icon: Compass,
  },
];

export function BuildModeMenu({
  value,
  onChange,
  disabled = false,
}: {
  value: BuildChatMode;
  onChange: (value: BuildChatMode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const current = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function openMenu() {
    setActive(Math.max(0, OPTIONS.findIndex((option) => option.value === value)));
    setOpen(true);
  }

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function choose(next: BuildChatMode) {
    onChange(next);
    close();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Agent mode: ${current.label}`}
        title={disabled ? "Wait for the current run to finish" : current.description}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            openMenu();
          }
        }}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:h-11",
          value === "plan"
            ? "bg-amber-400/12 text-amber-200 hover:bg-amber-400/18"
            : "text-white/65 hover:bg-white/[0.07] hover:text-white",
        )}
      >
        <current.icon className="size-3.5" aria-hidden="true" />
        <span>{current.label}</span>
        <ChevronUp className={cn("size-3 opacity-60 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Choose Build or Plan mode"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => (index + 1) % OPTIONS.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => (index - 1 + OPTIONS.length) % OPTIONS.length);
            } else if (event.key === "Tab") {
              close(false);
            }
          }}
          className="absolute bottom-full right-0 z-30 mb-1.5 w-64 rounded-xl border border-white/[0.12] bg-[#1b1b1b] p-1 shadow-[0_14px_36px_rgba(0,0,0,.5)]"
        >
          {OPTIONS.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => choose(option.value)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/70",
                  selected ? "bg-white/[0.08] text-white" : "text-white/75 hover:bg-white/[0.05] hover:text-white",
                )}
              >
                <option.icon className="mt-0.5 size-3.5 shrink-0 text-white/70" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium leading-4">{option.label}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-4 text-white/45">{option.description}</span>
                </span>
                {selected ? <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
