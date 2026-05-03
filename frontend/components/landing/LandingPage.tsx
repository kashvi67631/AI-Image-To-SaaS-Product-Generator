"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Menu, Play, Sparkles, User, X } from "lucide-react";
import * as React from "react";
import { DesignerWorkspace } from "@/components/features/workspace/DesignerWorkspace";
import { luxeSerif } from "@/lib/fonts/luxe-serif";
import {
  appendPromptHistory,
  incrementTotalProjectsCreated,
  loadPromptHistory,
} from "@/lib/prompt-history";
import { pickRandomSurprisePrompt } from "@/lib/surprise-prompts";
import { ThemeToggle } from "@/components/ThemeToggle";

const LUXE_PROMPT_LAYOUT_ID = "luxegen-prompt-shell";

/** Light: organic glass + carved inner depth. Dark: handled via dark: overrides. */
const PROMPT_OUTER_LIGHT =
  "max-w-[min(52rem,94vw)] rounded-[1.85rem] border-2 border-[#a07830]/55 bg-[#fdfbf4]/88 shadow-[0_10px_40px_rgba(139,105,20,0.07),inset_0_1px_0_rgba(255,255,255,0.85),inset_0_-10px_28px_rgba(160,120,48,0.06),inset_4px_4px_12px_rgba(255,255,255,0.45)] backdrop-blur-2xl";

function ProfileMenu() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Profile"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="glass-btn inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50/70 dark:text-zinc-100 dark:hover:bg-white/10"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <User className="h-3.5 w-3.5 text-zinc-600 dark:text-amber-200/90" aria-hidden />
        <span className="hidden sm:inline">Profile</span>
      </motion.button>
      {open ? (
        <div
          role="dialog"
          aria-label="Profile"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-[70] w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-amber-200/40 bg-[#fdfbf4]/95 p-4 shadow-xl backdrop-blur-xl dark:border-[#fccf45]/25 dark:bg-[#261e01]/95"
        >
          <p
            className={`${luxeSerif.className} text-sm font-semibold text-amber-950 dark:text-[#fccf45]`}
          >
            Your profile
          </p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-white/55">
            You&apos;re browsing as a guest. Account sign-in and saved projects can plug in here later.
          </p>
          <div className="mt-3 flex h-12 w-12 items-center justify-center rounded-full border border-amber-200/50 bg-white/60 text-xs font-medium text-zinc-500 dark:border-[#fccf45]/30 dark:bg-white/5 dark:text-white/50">
            LG
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Sits inside `.luxe-dashboard-shell` (relative). Must use z-0 — not negative z — or orbs hide behind the shell's solid background. */
function LuxeMeshBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 min-h-full overflow-hidden"
      aria-hidden
    >
      <div className="luxe-dashboard-mesh absolute inset-0" />
      {/* Light: slow-moving circular gradients (EFE9B4, FBBA98, FFFEBF, DDFFE2, BFE4FF) */}
      <div className="absolute inset-0 dark:hidden">
        <div className="luxe-light-orb luxe-light-orb-1" />
        <div className="luxe-light-orb luxe-light-orb-2" />
        <div className="luxe-light-orb luxe-light-orb-3" />
        <div className="luxe-light-orb luxe-light-orb-4" />
        <div className="luxe-light-orb luxe-light-orb-5" />
      </div>
      {/* Dark: animated mesh orbs (#531D01, #FCCF45, #DDFFE2, #BFE4FF, #261E01) */}
      <div className="absolute inset-0 hidden dark:block">
        <div className="luxe-dark-orb luxe-dark-orb-1" />
        <div className="luxe-dark-orb luxe-dark-orb-2" />
        <div className="luxe-dark-orb luxe-dark-orb-3" />
        <div className="luxe-dark-orb luxe-dark-orb-4" />
        <div className="luxe-dark-orb luxe-dark-orb-5" />
      </div>
    </div>
  );
}

export function LandingPage() {
  const [phase, setPhase] = React.useState<"hero" | "workspace">("hero");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [promptDraft, setPromptDraft] = React.useState("");
  const [workspaceRun, setWorkspaceRun] = React.useState<{
    prompt: string;
    key: number;
  } | null>(null);
  const [promptHistory, setPromptHistory] = React.useState<string[]>([]);

  React.useEffect(() => {
    setPromptHistory(loadPromptHistory());
  }, []);

  React.useEffect(() => {
    if (!menuOpen) {
      return;
    }
    setPromptHistory(loadPromptHistory());
  }, [menuOpen]);

  function goToWorkspace() {
    const trimmed = promptDraft.trim();
    if (!trimmed) {
      return;
    }
    setPromptHistory(appendPromptHistory(trimmed));
    incrementTotalProjectsCreated();
    setWorkspaceRun((prev) => ({
      prompt: trimmed,
      key: (prev?.key ?? 0) + 1,
    }));
    setPhase("workspace");
    setMenuOpen(false);
  }

  function applySurprisePrompt() {
    setPromptDraft(pickRandomSurprisePrompt());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      goToWorkspace();
    }
  }

  return (
    <LayoutGroup id="luxe-dashboard">
      <div className="luxe-dashboard-shell relative isolate flex min-h-screen w-full flex-col overflow-hidden selection:bg-amber-100/80 dark:selection:bg-amber-900/30">
        <LuxeMeshBackground />

        {phase === "hero" ? (
          <nav className="relative z-10 flex w-full shrink-0 items-center justify-between border-b border-amber-200/30 bg-[#f5e8d8]/50 px-5 py-4 backdrop-blur-xl md:px-8 dark:border-[#fccf45]/22 dark:bg-[#261e01]/55">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                className="rounded-lg p-1.5 text-[#5c4a2a] transition hover:bg-white/40 dark:text-[#d4af37] dark:hover:bg-white/5"
                aria-label="Open menu"
              >
                <Menu className="h-6 w-6" strokeWidth={2} />
              </button>
              <span
                className={`${luxeSerif.className} text-lg font-medium tracking-tight text-[#6b5420] md:text-xl dark:text-[#d4af37]`}
              >
                Luxegen
              </span>
            </div>
            <div className="flex items-center gap-2">
              <ProfileMenu />
              <ThemeToggle />
            </div>
          </nav>
        ) : null}

        <AnimatePresence>
          {menuOpen ? (
            <>
              <motion.button
                type="button"
                aria-label="Close menu"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] bg-black/25 backdrop-blur-[2px] dark:bg-black/55"
                onClick={() => setMenuOpen(false)}
              />
              <motion.aside
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", stiffness: 320, damping: 34 }}
                className="fixed top-0 left-0 z-[61] flex h-full min-h-0 w-[min(18.5rem,88vw)] flex-col border-r border-amber-200/35 bg-[#f7f3ec]/95 py-5 pl-4 pr-3 shadow-2xl backdrop-blur-2xl dark:border-[#fccf45]/18 dark:bg-[#261e01]/98"
              >
                <div className="mb-4 flex items-center justify-between gap-2 pr-1">
                  <p
                    className={`${luxeSerif.className} text-sm font-semibold text-zinc-800 dark:text-[#fccf45]`}
                  >
                    Chats
                  </p>
                  <button
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-lg p-2 text-zinc-600 hover:bg-black/[0.06] dark:text-zinc-300 dark:hover:bg-white/10"
                    aria-label="Close menu"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain pr-1">
                  {promptHistory.length === 0 ? (
                    <li className="rounded-lg px-2 py-8 text-center text-xs leading-relaxed text-zinc-500 dark:text-white/45">
                      No chats yet. Send a prompt from the box below.
                    </li>
                  ) : (
                    promptHistory.map((entry, index) => (
                      <li key={`${index}-${entry.slice(0, 48)}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setPromptDraft(entry);
                            setMenuOpen(false);
                          }}
                          className="w-full rounded-lg px-2.5 py-2.5 text-left text-[13px] leading-snug text-zinc-800 transition hover:bg-black/[0.06] dark:text-white/90 dark:hover:bg-white/[0.08]"
                        >
                          <span className="line-clamp-4">{entry}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </motion.aside>
            </>
          ) : null}
        </AnimatePresence>

        {phase === "hero" ? (
          <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-16 pb-32 md:px-8 md:py-20">
            <motion.div
              className="mb-14 w-full max-w-[min(52rem,94vw)] text-center md:mb-16"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            >
              <h1
                className={`${luxeSerif.className} mb-6 text-4xl font-bold leading-[1.1] tracking-tight text-zinc-950 md:text-6xl lg:text-[3.5rem] dark:text-white dark:drop-shadow-[0_4px_24px_rgba(0,0,0,0.45)]`}
              >
                AI-Powered Luxury UI
              </h1>
              <p className="mx-auto max-w-xl font-sans text-sm font-normal leading-relaxed text-zinc-900 md:max-w-2xl md:text-base dark:text-white/50 dark:tracking-normal">
                <span className="tracking-[0.12em] md:tracking-[0.2em]">
                  Prompt, stream, and refine — your live preview updates as components take shape.
                </span>
              </p>
            </motion.div>

            <motion.div
              layoutId={LUXE_PROMPT_LAYOUT_ID}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              className={`relative w-full overflow-hidden ${PROMPT_OUTER_LIGHT} dark:max-w-3xl dark:rounded-2xl dark:border-2 dark:border-[#d4af37]/30 dark:bg-transparent dark:shadow-[0_0_40px_rgba(0,0,0,0.5)] dark:backdrop-blur-none`}
            >
              <div className="relative dark:rounded-2xl dark:bg-[#fdfbf4]/90 dark:backdrop-blur-md dark:p-2">
                <label htmlFor="landing-hero-prompt" className="sr-only">
                  Describe the UI you want
                </label>
                <textarea
                  id="landing-hero-prompt"
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Describe The UI You Want..."
                  className={`${luxeSerif.className} min-h-[11.5rem] w-full resize-none bg-transparent p-10 pb-32 text-lg leading-relaxed outline-none placeholder:text-sm placeholder:text-zinc-400 placeholder:font-sans dark:p-4 dark:pb-24 dark:font-medium dark:text-slate-900 dark:placeholder:font-sans dark:placeholder:text-slate-500 md:min-h-[12.5rem]`}
                />
                <motion.button
                  type="button"
                  onClick={applySurprisePrompt}
                  title="Fill with a random luxury UI idea"
                  aria-label="Surprise me with a random prompt"
                  className="absolute bottom-10 left-10 z-[1] inline-flex items-center gap-2 rounded-md border border-[#c4b8a5]/70 bg-gradient-to-b from-[#f5f0e8] to-[#e8e2d8] px-3 py-2 text-xs font-medium text-zinc-800 shadow-sm transition hover:from-[#efe9e0] hover:to-[#e0d9ce] dark:bottom-3 dark:left-3 dark:border-[#b8ae9c]/60 dark:from-[#3a3428] dark:to-[#2e2920] dark:text-[#fccf45] dark:hover:from-[#423a2e] dark:hover:to-[#322c24]"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="max-w-[10rem] truncate sm:max-w-none sm:whitespace-normal">
                    Surprise me
                  </span>
                </motion.button>
                <motion.button
                  type="button"
                  onClick={goToWorkspace}
                  disabled={!promptDraft.trim()}
                  title="Continue"
                  aria-label="Continue to workspace"
                  className="absolute right-10 bottom-10 flex h-11 w-11 items-center justify-center rounded-md border border-[#c4b8a5]/70 bg-gradient-to-b from-[#ebe4d8] to-[#dcd3c4] shadow-sm transition hover:from-[#e5ddd0] hover:to-[#d4cbbf] disabled:cursor-not-allowed disabled:opacity-35 dark:right-3 dark:bottom-3 dark:border-[#b8ae9c]/60 dark:from-[#d4d0c8] dark:to-[#c9c5bc] dark:hover:from-[#d4d0c8] dark:hover:to-[#c9c5bc]"
                  whileHover={{ scale: promptDraft.trim() ? 1.04 : 1 }}
                  whileTap={{ scale: promptDraft.trim() ? 0.96 : 1 }}
                >
                  <Play
                    className="ml-0.5 h-4 w-4 fill-zinc-900 text-zinc-900 dark:fill-black dark:text-black"
                    aria-hidden
                  />
                </motion.button>
              </div>
            </motion.div>
          </main>
        ) : null}

        {phase === "workspace" && workspaceRun ? (
          <div className="relative z-10 min-h-0 flex-1">
            <DesignerWorkspace
              autoRunPrompt={workspaceRun.prompt}
              autoRunKey={workspaceRun.key}
              overlayOnHeroGradient
              useFloatingPromptBar
              heroToWorkspaceLayoutId={LUXE_PROMPT_LAYOUT_ID}
              animateCanvasEntrance
            />
          </div>
        ) : null}
      </div>
    </LayoutGroup>
  );
}
