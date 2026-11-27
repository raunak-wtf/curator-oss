"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject, type SyntheticEvent } from "react";
import { toast } from "sonner";
import { normalizeSkillName, parseSkillCommand } from "@/lib/skills";
import type { Skill, SkillDraft, SkillSource } from "@/lib/types";
import { SkillApiError, skillApi } from "./skill-api";
import { BUILTIN_SKILL_ITEMS, COMMAND_ITEMS, SkillCommandMenu, optionId, type SlashMenuItem } from "./skill-command-menu";
import { SkillEditorDialog, type SkillEditorState } from "./skill-editor-dialog";
import { SkillsManagerDialog } from "./skills-manager-dialog";

type UseSkillCommandsOptions = {
  prompt: string;
  setPrompt: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  signedIn: boolean;
};

type SlashToken = { start: number; end: number; query: string };

/** The `/word` being typed at the caret, when it starts a word. */
function slashTokenAt(text: string, caret: number): SlashToken | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)\/([a-z0-9-]*)$/i.exec(before);
  if (!match) return null;
  return { start: caret - match[1].length - 1, end: caret, query: match[1].toLowerCase() };
}

function emptyDraft(source: SkillSource, name = ""): SkillDraft {
  return { name, description: "", body: "", source, sourceUrl: null };
}

const MAX_SKILL_ITEMS = 50;

export function useSkillCommands({ prompt, setPrompt, textareaRef, signedIn }: UseSkillCommandsOptions) {
  const menuId = useId();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsStatus, setSkillsStatus] = useState<"idle" | "loading" | "ready" | "error">(signedIn ? "loading" : "idle");
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState({ key: "", index: 0 });
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<SkillEditorState | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const requestRef = useRef(0);
  const editorKeyRef = useRef(0);

  const loadSkills = useCallback(async () => {
    try {
      const list = await skillApi.list();
      setSkills(list);
      setSkillsStatus("ready");
    } catch {
      setSkillsStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    skillApi
      .list()
      .then((list) => {
        if (cancelled) return;
        setSkills(list);
        setSkillsStatus("ready");
      })
      .catch(() => !cancelled && setSkillsStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  function retryLoad() {
    setSkillsStatus("loading");
    void loadSkills();
  }

  const token = slashTokenAt(prompt, Math.min(caret, prompt.length));
  const tokenKey = token ? `${token.start}:${token.query}` : "";

  const items: SlashMenuItem[] = [];
  if (token) {
    const query = token.query;
    const commands = COMMAND_ITEMS.filter((item) => item.name.includes(query));
    const matchingBuiltins = BUILTIN_SKILL_ITEMS.filter(
      (item) => item.name.includes(query) || item.description.toLowerCase().includes(query),
    );
    const matchingSkills = skills
      .filter((skill) => skill.name.includes(query) || skill.description.toLowerCase().includes(query))
      .sort((a, b) => Number(!a.name.startsWith(query)) - Number(!b.name.startsWith(query)))
      .slice(0, MAX_SKILL_ITEMS)
      .map((skill): SlashMenuItem => ({ kind: "skill", name: skill.name, description: skill.description, skill }));
    // Put an exact skill match first so `/my-skill` or `/cloud-fullstack` + Enter picks the skill, not a command.
    if (query && matchingBuiltins.some((item) => item.name === query)) {
      items.push(...matchingBuiltins, ...matchingSkills, ...commands);
    } else if (query && matchingSkills.some((item) => item.name === query)) {
      items.push(...matchingSkills, ...matchingBuiltins, ...commands);
    } else {
      items.push(...commands, ...matchingBuiltins, ...matchingSkills);
    }
  }

  const showLoadingRow = signedIn && skillsStatus !== "ready" && skillsStatus !== "idle";
  const menuOpen = Boolean(token) && dismissedKey !== tokenKey && (items.length > 0 || showLoadingRow);
  const activeIndex = highlight.key === tokenKey ? Math.min(highlight.index, Math.max(items.length - 1, 0)) : 0;

  function syncCaret(event: SyntheticEvent<HTMLTextAreaElement>) {
    setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
  }

  function replaceToken(replacement: string) {
    if (!token) return;
    const next = `${prompt.slice(0, token.start)}${replacement}${prompt.slice(token.end)}`;
    const position = token.start + replacement.length;
    setPrompt(next);
    setCaret(position);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(position, position);
    });
  }

  function focusComposer(value: string) {
    setPrompt(value);
    setCaret(value.length);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(value.length, value.length);
    });
  }

  function requireSignIn() {
    if (signedIn) return true;
    toast.error("Sign in to create and use skills.", {
      action: { label: "Sign in", onClick: () => window.location.assign("/auth/login") },
    });
    return false;
  }

  function nextEditorKey() {
    editorKeyRef.current += 1;
    return editorKeyRef.current;
  }

  function openManualEditor(name = "") {
    requestRef.current += 1;
    setEditor({ key: nextEditorKey(), skillId: null, status: "ready", draft: emptyDraft("manual", normalizeSkillName(name)) });
  }

  function loadDraft(source: "ai" | "github", label: string, load: () => Promise<SkillDraft>) {
    const requestId = (requestRef.current += 1);
    const retry = () => loadDraft(source, label, load);
    setEditor({ key: nextEditorKey(), skillId: null, status: "loading", loadingLabel: label, draft: emptyDraft(source) });
    load()
      .then((draft) => {
        if (requestRef.current !== requestId) return;
        setEditor({ key: nextEditorKey(), skillId: null, status: "ready", draft });
      })
      .catch((error: unknown) => {
        if (requestRef.current !== requestId) return;
        const message = error instanceof Error ? error.message : "Something went wrong. Try again.";
        setEditor({ key: nextEditorKey(), skillId: null, status: "error", error: message, retry, draft: emptyDraft(source) });
      });
  }

  function runSkillCommand(command: ReturnType<typeof parseSkillCommand>, clearPrompt = true) {
    if (!command) return false;
    if (!requireSignIn()) return true;
    const { argument } = command;
    const clear = () => clearPrompt && setPrompt("");

    if (command.command === "create-skill") {
      if (argument.length < 3) {
        toast.message("Describe the skill after /create-skill.", {
          description: "For example: /create-skill Build forms with react-hook-form and zod validation",
        });
        focusComposer("/create-skill ");
        return true;
      }
      clear();
      loadDraft("ai", "Writing your skill…", () => skillApi.generate(argument));
    } else if (command.command === "install-skill") {
      if (!argument) {
        toast.message("Paste a GitHub link after /install-skill.", {
          description: "A repository, a skill folder, or a SKILL.md file.",
        });
        focusComposer("/install-skill ");
        return true;
      }
      clear();
      loadDraft("github", "Downloading the skill from GitHub…", () => skillApi.import(argument));
    } else if (command.command === "new-skill") {
      clear();
      openManualEditor(argument);
    } else {
      clear();
      setManagerOpen(true);
      if (skillsStatus === "error") retryLoad();
    }
    return true;
  }

  /** Runs a skill command typed in the composer. Returns true when the text was a command and was handled. */
  function runCommand(text: string) {
    return runSkillCommand(parseSkillCommand(text));
  }

  function selectItem(item: SlashMenuItem) {
    if (item.kind === "skill" || item.kind === "builtin") {
      replaceToken(`/${item.name} `);
      return;
    }
    if (item.argumentHint) {
      replaceToken(`/${item.name} `);
      return;
    }
    // Commands without an argument run straight away and leave the rest of the prompt in place.
    if (token) setPrompt(`${prompt.slice(0, token.start)}${prompt.slice(token.end)}`.trim());
    runSkillCommand({ command: item.name, argument: "" }, false);
  }

  /** Handles menu navigation. Returns true when the key was consumed and the composer should ignore it. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!menuOpen || event.nativeEvent.isComposing) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!items.length) return false;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight({ key: tokenKey, index: (activeIndex + step + items.length) % items.length });
      return true;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      const item = items[activeIndex];
      if (!item) return false;
      event.preventDefault();
      selectItem(item);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedKey(tokenKey);
      return true;
    }
    return false;
  }

  function closeEditor() {
    requestRef.current += 1;
    setEditor(null);
  }

  function handleSaved(skill: Skill, created: boolean) {
    setSkills((current) => [...current.filter((item) => item.id !== skill.id), skill].sort((a, b) => a.name.localeCompare(b.name)));
    setSkillsStatus("ready");
    setEditor(null);
    toast.success(created ? `Saved /${skill.name}.` : `Updated /${skill.name}.`, {
      description: created ? `Type /${skill.name} in a prompt to use it.` : undefined,
    });
  }

  async function deleteSkill(skill: Skill) {
    try {
      await skillApi.remove(skill.id);
    } catch (error) {
      // Already gone is the outcome the user asked for.
      if (!(error instanceof SkillApiError && error.status === 404)) throw error;
    }
    setSkills((current) => current.filter((item) => item.id !== skill.id));
    toast.success(`Deleted /${skill.name}.`);
  }

  const menu = menuOpen ? (
    <SkillCommandMenu
      id={menuId}
      items={items}
      activeIndex={activeIndex}
      skillsStatus={signedIn ? skillsStatus : "idle"}
      onRetryLoad={retryLoad}
      onHighlight={(index) => setHighlight({ key: tokenKey, index })}
      onSelect={selectItem}
    />
  ) : null;

  const dialogs = (
    <>
      <SkillsManagerDialog
        open={managerOpen}
        skills={skills}
        status={skillsStatus}
        onClose={() => setManagerOpen(false)}
        onRetryLoad={retryLoad}
        onEdit={(skill) =>
          setEditor({
            key: nextEditorKey(),
            skillId: skill.id,
            status: "ready",
            draft: { name: skill.name, description: skill.description, body: skill.body, source: skill.source, sourceUrl: skill.sourceUrl },
          })
        }
        onDelete={deleteSkill}
        onStartCommand={(command) => {
          setManagerOpen(false);
          focusComposer(`/${command} `);
        }}
        onWriteManually={() => openManualEditor()}
      />
      <SkillEditorDialog state={editor} onClose={closeEditor} onSaved={handleSaved} onWriteManually={() => openManualEditor()} />
    </>
  );

  return {
    menu,
    dialogs,
    onKeyDown,
    runCommand,
    /** Starts a `/` at the end of the prompt and focuses the composer, which opens the menu. */
    openMenu: () => focusComposer(prompt && !/\s$/.test(prompt) ? `${prompt} /` : `${prompt}/`),
    textareaProps: {
      onSelect: syncCaret,
      "aria-autocomplete": "list" as const,
      "aria-controls": menuOpen ? menuId : undefined,
      "aria-activedescendant": menuOpen && items.length ? optionId(menuId, activeIndex) : undefined,
    },
    syncCaret,
  };
}
