"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/*
 * Pixel-grid loader. Default "Dots": nine round cells with a chevron wavefront driving right.
 * The 650 ms cycle is shorter than the sweep, so two fronts are always in flight.
 * Reduced motion freezes the grid at its dim state (see `.pixel-cell` in globals.css); the timer still ticks.
 */

const chevron = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, index) => {
  const step = ORBIT_ORDER.indexOf(index);
  return step === -1 ? null : step * 110;
});

const PATTERNS = {
  Dots: { delays: chevron, duration: 650, round: true },
  Drive: { delays: chevron, duration: 650, round: false },
  Orbit: { delays: orbit, duration: 950, round: false },
} as const;

export type PixelLoaderVariant = keyof typeof PATTERNS;

const SIZES = {
  sm: { cell: 3, gap: 1 },
  md: { cell: 4, gap: 1.5 },
  lg: { cell: 6, gap: 2 },
} as const;

/** The animated grid alone, for use in place of an icon. Inherits the text color. */
export function PixelLoader({
  variant = "Dots",
  size = "md",
  className,
}: {
  variant?: PixelLoaderVariant;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { delays, duration, round } = PATTERNS[variant];
  const { cell, gap } = SIZES[size];
  return (
    <span
      aria-hidden="true"
      className={cn("inline-grid shrink-0", className)}
      style={{ gridTemplateColumns: `repeat(3, ${cell}px)`, gap }}
    >
      {delays.map((delay, index) => (
        <span
          key={index}
          className={cn("pixel-cell bg-current", round ? "rounded-full" : "rounded-[1px]")}
          style={{
            width: cell,
            height: cell,
            opacity: delay === null ? 0.07 : 0.15,
            animation: delay === null ? "none" : `pixel-on ${duration}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

function useElapsed() {
  const [tenths, setTenths] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTenths((current) => current + 1), 100);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = tenths / 10;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

/** Grid, a softly pulsing label, and a live elapsed timer in tabular figures, for long-running work. */
export function LoadingState({
  label = "Working",
  variant = "Dots",
  showElapsed = true,
  className,
}: {
  label?: string;
  variant?: PixelLoaderVariant;
  showElapsed?: boolean;
  className?: string;
}) {
  const elapsed = useElapsed();
  return (
    <span role="status" className={cn("inline-flex w-fit items-center gap-2.5 text-white/85", className)}>
      <PixelLoader variant={variant} />
      <span className="pixel-label text-[13px] font-medium">{label}</span>
      {showElapsed ? (
        <span className="font-mono text-[12px] tabular-nums text-white/40" aria-hidden="true">
          {elapsed}
        </span>
      ) : null}
    </span>
  );
}
