"use client";

import { Check, ChevronDown, ChevronUp, CornerDownLeft, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Agent question card (human in the loop). One question at a time: the stack slides as you move
 * between questions and the card height animates to fit, the step counter rolls like an odometer,
 * and the footer has a quiet Skip and a primary Continue. Single-choice answers auto-advance;
 * multi-select waits for Continue.
 */

export type QuestionCardQuestion = {
  question: string;
  type: "single" | "multiple";
  options: string[];
  /** Optional content shown under the question, such as the change an approval is for. */
  detail?: ReactNode;
};

const ROLL_MS = 400;
const SLIDE = "360ms cubic-bezier(0.22, 1, 0.36, 1)";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Odometer digits: each changed character rolls up, or down when the number decreases. */
function RollingDigits({ value }: { value: string }) {
  const previous = useRef(value);
  const [oldValue, setOldValue] = useState(value);
  const [newValue, setNewValue] = useState(value);
  const [rolling, setRolling] = useState(false);
  const [shifted, setShifted] = useState(false);
  const [direction, setDirection] = useState<"up" | "down">("up");

  useEffect(() => {
    if (previous.current === value) return;
    const from = previous.current;
    previous.current = value;
    const fromNumber = parseInt(from, 10);
    const toNumber = parseInt(value, 10);
    const reduce = prefersReducedMotion();
    let frame1 = 0;
    let frame2 = 0;
    // Start the roll on the next frame so these updates are not synchronous inside the effect.
    frame1 = requestAnimationFrame(() => {
      setDirection(Number.isFinite(fromNumber) && Number.isFinite(toNumber) && toNumber < fromNumber ? "down" : "up");
      setOldValue(from);
      setNewValue(value);
      setRolling(!reduce);
      setShifted(false);
      if (reduce) setOldValue(value);
      frame2 = requestAnimationFrame(() => setShifted(true));
    });
    const done = window.setTimeout(() => {
      setRolling(false);
      setOldValue(value);
      setShifted(false);
    }, ROLL_MS);
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
      window.clearTimeout(done);
    };
  }, [value]);

  const characters = rolling ? newValue : oldValue;
  return (
    <>
      {Array.from({ length: characters.length }, (_, index) => {
        const before = oldValue[index] ?? "";
        const after = characters[index] ?? "";
        if (!rolling || before === after) return <span key={`${index}-${after}`}>{after}</span>;
        const top = direction === "down" ? after : before;
        const bottom = direction === "down" ? before : after;
        const rest = direction === "down" ? "0" : "-1em";
        const start = direction === "down" ? "-1em" : "0";
        return (
          <span
            key={`${index}-${before}-${after}-${direction}`}
            style={{ display: "inline-block", position: "relative", overflow: "hidden", height: "1em", lineHeight: "1em", verticalAlign: "-0.05em" }}
          >
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                transition: "transform 350ms cubic-bezier(0.4, 0, 0.2, 1)",
                transform: `translateY(${shifted ? rest : start})`,
              }}
            >
              <span style={{ height: "1em", lineHeight: "1em" }}>{top}</span>
              <span style={{ height: "1em", lineHeight: "1em" }}>{bottom}</span>
            </span>
          </span>
        );
      })}
    </>
  );
}

type AgentQuestionCardProps = {
  questions: QuestionCardQuestion[];
  /** Answers per question, including any typed custom answer. Empty arrays mean skipped. */
  onSubmit: (answers: string[][]) => void;
  /** Optional context shown above the first question. */
  intro?: ReactNode;
  allowCustom?: boolean;
  autoAdvance?: boolean;
  disabled?: boolean;
  /** Can the card be dismissed with ✕ or Escape? Approvals stay open until answered. */
  dismissible?: boolean;
  /** Wider layout, for questions that show code. */
  wide?: boolean;
  labels?: Partial<{ skip: string; continue: string; send: string; customPlaceholder: string }>;
};

export function AgentQuestionCard({
  questions,
  onSubmit,
  intro,
  allowCustom = true,
  autoAdvance = true,
  disabled = false,
  dismissible = true,
  wide = false,
  labels,
}: AgentQuestionCardProps) {
  const text = { skip: "Skip", continue: "Continue", send: "Send", customPlaceholder: "Something else…", ...labels };
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<Record<number, number[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [open, setOpen] = useState(true);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const measured = useRef(false);
  const [viewportHeight, setViewportHeight] = useState<number | undefined>(undefined);
  const [trackY, setTrackY] = useState(0);
  const [animate, setAnimate] = useState(false);
  // Until the first measure, render only the active question so the card opens at its real height.
  const [ready, setReady] = useState(false);

  const last = index === questions.length - 1;
  const selected = picked[index] ?? [];
  const hasAnswer = selected.length > 0 || Boolean(custom[index]?.trim());

  useLayoutEffect(() => {
    const item = questionRefs.current[index];
    if (!item) return;
    const withAnimation = measured.current && !prefersReducedMotion();
    measured.current = true;
    setViewportHeight(item.offsetHeight);
    setTrackY(item.offsetTop);
    setAnimate(withAnimation);
    setReady(true);
  }, [index, picked, custom, open, ready]);

  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
  }, []);

  function answersFor(current: Record<number, number[]>, currentCustom: Record<number, string>) {
    return questions.map((question, questionIndex) => {
      const chosen = (current[questionIndex] ?? []).map((optionIndex) => question.options[optionIndex]);
      const typed = currentCustom[questionIndex]?.trim();
      return typed ? [...chosen, typed] : chosen;
    });
  }

  function goTo(next: number) {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setIndex(Math.min(Math.max(next, 0), questions.length - 1));
  }

  function send(current = picked, currentCustom = custom) {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    onSubmit(answersFor(current, currentCustom));
  }

  function advance() {
    if (last) send();
    else goTo(index + 1);
  }

  function toggle(optionIndex: number) {
    if (disabled) return;
    const question = questions[index];
    const current = picked[index] ?? [];
    const next = question.type === "single"
      ? [optionIndex]
      : current.includes(optionIndex)
        ? current.filter((item) => item !== optionIndex)
        : [...current, optionIndex];
    const nextPicked = { ...picked, [index]: next };
    setPicked(nextPicked);
    if (question.type === "single") {
      const nextCustom = { ...custom, [index]: "" };
      setCustom(nextCustom);
      if (!autoAdvance) return;
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      const questionIndex = index;
      advanceTimer.current = setTimeout(() => {
        if (questionIndex === questions.length - 1) send(nextPicked, nextCustom);
        else setIndex(questionIndex + 1);
      }, 480);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex h-8 items-center rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12.5px] font-medium text-white/80 hover:bg-white/[0.08] hover:text-white [@media(pointer:coarse)]:h-11"
      >
        {questions.length === 1 ? "Answer the question" : `Answer ${questions.length} questions`}
      </button>
    );
  }

  const pill = "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors [@media(pointer:coarse)]:h-11";

  return (
    <div
      className={cn(
        "agent-question-card relative mt-3 w-full overflow-hidden rounded-xl border border-white/10 bg-[#232323] shadow-[0_12px_32px_rgba(0,0,0,.35)]",
        wide ? "max-w-[520px]" : "max-w-80",
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape" && dismissible) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      {dismissible ? (
        <button
          type="button"
          aria-label="Dismiss questions"
          onClick={() => setOpen(false)}
          className="absolute right-1.5 top-1.5 z-10 grid size-8 place-items-center rounded-md text-white/45 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11"
        >
          <X className="size-3.5" />
        </button>
      ) : null}

      <div className="px-4 pb-3 pt-3.5">
        {intro ? <div className="mb-2.5 pr-7 text-[12px] leading-5 text-white/55">{intro}</div> : null}
        <div className="overflow-hidden" style={{ height: viewportHeight, transition: animate ? `height ${SLIDE}` : undefined }} aria-live="polite">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 26,
              transform: `translate3d(0, ${-trackY}px, 0)`,
              transition: animate ? `transform ${SLIDE}` : undefined,
            }}
          >
            {questions.map((question, questionIndex) => {
              const active = questionIndex === index;
              if (!ready && !active) return null;
              const chosen = picked[questionIndex] ?? [];
              const style: CSSProperties = {
                opacity: active ? 1 : 0,
                transition: animate ? `opacity ${SLIDE}` : undefined,
                pointerEvents: active ? undefined : "none",
              };
              const headingId = `agent-question-${questionIndex}`;
              return (
                <div
                  key={questionIndex}
                  ref={(element) => {
                    questionRefs.current[questionIndex] = element;
                  }}
                  aria-hidden={active ? undefined : true}
                  inert={!active}
                  style={style}
                >
                  <p id={headingId} className="pr-7 text-[14px] font-medium text-white">
                    {question.question}
                  </p>
                  {question.detail ? <div className="mt-2">{question.detail}</div> : null}
                  <div
                    role={question.type === "single" ? "radiogroup" : "group"}
                    aria-labelledby={headingId}
                    className="mt-2.5 flex flex-col gap-0.5"
                  >
                    {question.options.map((option, optionIndex) => {
                      const on = chosen.includes(optionIndex);
                      return (
                        <button
                          key={option}
                          type="button"
                          role={question.type === "single" ? "radio" : "checkbox"}
                          aria-checked={on}
                          disabled={disabled}
                          onClick={() => toggle(optionIndex)}
                          className="flex min-h-8 items-center gap-2 rounded-md py-1 pl-1.5 pr-2 text-left transition-colors hover:bg-white/[0.06] disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
                        >
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center transition-colors duration-200",
                              question.type === "single" ? "rounded-full" : "rounded-[5px]",
                              on ? "bg-white text-black" : "text-transparent shadow-[inset_0_0_0_1.5px_rgba(255,255,255,.28)]",
                            )}
                          >
                            {question.type === "single" ? (
                              <span className="size-1.5 rounded-full bg-black transition-transform duration-200" style={{ transform: on ? "scale(1)" : "scale(0)" }} />
                            ) : (
                              <Check className="size-3 stroke-[3]" />
                            )}
                          </span>
                          <span className={cn("text-[13px] leading-5 transition-colors", on ? "text-white" : "text-white/70")}>{option}</span>
                        </button>
                      );
                    })}
                    {allowCustom ? (
                      <input
                        value={custom[questionIndex] ?? ""}
                        disabled={disabled}
                        onChange={(event) => {
                          setCustom((current) => ({ ...current, [questionIndex]: event.target.value }));
                          if (question.type === "single") setPicked((current) => ({ ...current, [questionIndex]: [] }));
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && hasAnswer) {
                            event.preventDefault();
                            advance();
                          }
                        }}
                        placeholder={text.customPlaceholder}
                        aria-label={`Your own answer to: ${question.question}`}
                        className="mt-0.5 h-8 rounded-md bg-transparent px-2 text-[13px] text-white outline-none placeholder:text-white/35 hover:bg-white/[0.04] focus:bg-white/[0.06] [@media(pointer:coarse)]:h-11"
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-3 py-2">
        <div className="flex items-center gap-0.5 text-white/45">
          {questions.length > 1 ? (
            <>
              <button
                type="button"
                aria-label="Previous question"
                disabled={index <= 0}
                onClick={() => goTo(index - 1)}
                className="grid size-8 place-items-center rounded-md enabled:hover:text-white disabled:opacity-30 [@media(pointer:coarse)]:size-11"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <span className="inline-flex items-center text-[12px] font-medium tabular-nums" style={{ lineHeight: 1 }} aria-label={`Question ${index + 1} of ${questions.length}`}>
                <RollingDigits value={`${index + 1} / ${questions.length}`} />
              </span>
              <button
                type="button"
                aria-label="Next question"
                disabled={last}
                onClick={() => goTo(index + 1)}
                className="grid size-8 place-items-center rounded-md enabled:hover:text-white disabled:opacity-30 [@media(pointer:coarse)]:size-11"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => (last ? send() : goTo(index + 1))}
            className={cn(pill, "text-white/70 hover:bg-white/[0.07] hover:text-white disabled:opacity-40")}
          >
            {text.skip}
          </button>
          <button
            type="button"
            disabled={!hasAnswer || disabled}
            onClick={advance}
            className={cn(pill, "bg-white text-black hover:bg-white/85 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/45")}
          >
            {last ? text.send : text.continue}
            <CornerDownLeft className="size-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

type CloudRequestCardProps = {
  reason: string;
  featureLabels: string[];
  busy: boolean;
  error: string | null;
  onEnable: () => void;
  onDecline: () => void;
};

/** Asks the user for explicit consent to enable Cognix Cloud before adding database, storage, sign-in, or email. */
export function CloudRequestCard({ reason, featureLabels, busy, error, onEnable, onDecline }: CloudRequestCardProps) {
  return (
    <div className="mt-3 w-full max-w-88 overflow-hidden rounded-xl border border-white/10 bg-[#232323] shadow-[0_12px_32px_rgba(0,0,0,.35)]">
      <div className="px-4 pb-3 pt-3.5">
        <p className="text-[14px] font-medium text-white">Allow Cognix Cloud for this app?</p>
        <p className="mt-1.5 text-[12.5px] leading-5 text-white/65">{reason}</p>
        <p className="mt-2 text-[12px] leading-5 text-white/45">
          Requested: <span className="font-medium text-white/75">{featureLabels.join(", ")}</span>. Approving enables Cognix Cloud
          (Database, Authentication, Storage, and Emails) for this project.
        </p>
        {error ? (
          <p role="alert" className="mt-2 rounded-md bg-red-500/10 px-2.5 py-1.5 text-[12px] leading-5 text-red-300">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-3 py-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          className="inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-medium text-white/70 hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-40 [@media(pointer:coarse)]:h-11"
        >
          Not now
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onEnable}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3.5 text-[12.5px] font-semibold text-black hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60 [@media(pointer:coarse)]:h-11"
        >
          {busy ? "Turning on…" : error ? "Try again" : "Allow & turn on"}
        </button>
      </div>
    </div>
  );
}
