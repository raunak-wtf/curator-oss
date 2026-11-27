"use client";

import { Check, ChevronUp, Eye, ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ApprovalMode } from "@/lib/types";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ApprovalMode; label: string; description: string; icon: typeof Eye }[] = [
  { value: "review", label: "Request review", description: "Every edit and command needs approval.", icon: Eye },
  { value: "auto", label: "Auto", description: "Runs edits and commands without asking.", icon: ShieldCheck },
];

/** Small dropdown in the composer that switches how a Security mode agent acts. */
export function ApprovalModeMenu({
  value,
  onChange,
  disabled = false,
}: {
  value: ApprovalMode;
  onChange: (value: ApprovalMode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const current = OPTIONS.find((option) => option.value === value) ?? OPTIONS[1];

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

  function choose(next: ApprovalMode) {
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
        aria-label={`Approval mode: ${current.label}`}
        title={disabled ? "You can change this when the agent finishes" : current.description}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            openMenu();
          }
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:h-11"
      >
        <current.icon className="size-3.5" aria-hidden="true" />
        {current.label}
        <ChevronUp className={cn("size-3 text-white/40 transition-transform motion-reduce:transition-none", !open && "rotate-180")} aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Approval mode"
          className="absolute bottom-[calc(100%+6px)] right-0 z-40 w-[min(312px,calc(100vw-24px))] rounded-xl border border-white/[0.1] bg-[#1d1d1d] p-1 shadow-[0_18px_50px_rgba(0,0,0,.55)]"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + OPTIONS.length) % OPTIONS.length);
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              setActive(event.key === "Home" ? 0 : OPTIONS.length - 1);
            } else if (event.key === "Tab") {
              close(false);
            }
          }}
        >
          {OPTIONS.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={index === active ? 0 : -1}
                onClick={() => choose(option.value)}
                onPointerEnter={() => setActive(index)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors [@media(pointer:coarse)]:min-h-11",
                  index === active ? "bg-white/[0.07]" : "hover:bg-white/[0.05]",
                )}
              >
                <option.icon className="mt-0.5 size-4 shrink-0 text-white/70" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-white">{option.label}</span>
                  <span className="block text-[11.5px] leading-4 text-white/45">{option.description}</span>
                </span>
                {selected ? <Check className="mt-0.5 size-3.5 shrink-0 text-white/80" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
