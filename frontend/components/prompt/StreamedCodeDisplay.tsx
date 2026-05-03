"use client";

import { motion } from "framer-motion";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

type StreamedCodeDisplayProps = {
  code: string;
  /** While true and code is still empty, show luxe streaming placeholder instead of nothing. */
  isStreaming?: boolean;
  /** Dark gold panel (workspace Streamed Code column). */
  variant?: "default" | "luxe";
};

export function StreamedCodeDisplay({
  code,
  isStreaming = false,
  variant = "default",
}: StreamedCodeDisplayProps) {
  const luxe = variant === "luxe";

  if (!code.trim()) {
    if (!isStreaming) {
      return null;
    }
    return (
      <div
        className={
          luxe
            ? "flex min-h-[18rem] flex-col justify-between gap-4 rounded-xl border border-[#d4af37]/25 bg-[#14110e]/90 p-5"
            : "flex min-h-[16rem] flex-col justify-between gap-4 rounded-2xl border border-zinc-200/80 bg-zinc-50/90 p-5 dark:border-white/10 dark:bg-[#0b0b0e]/90"
        }
      >
        <div>
          <p
            className={
              luxe
                ? "text-center font-medium tracking-wide text-[#e8dcc4]"
                : "text-center text-sm font-medium text-zinc-600 dark:text-zinc-300"
            }
          >
            {luxe ? "LuxeGen is streaming your component…" : "Receiving streamed TSX…"}
          </p>
          <p
            className={
              luxe
                ? "mt-2 text-center text-xs text-[#c4b49a]/90"
                : "mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400"
            }
          >
            Code appears here as tokens arrive from the API.
          </p>
        </div>
        <div className="space-y-3">
          <div
            className={`mx-auto h-3 rounded-full ${luxe ? "luxe-gold-shimmer max-w-[12rem]" : "max-w-[12rem] rounded-full bg-zinc-200/80 dark:bg-white/10"}`}
          />
          <div className={`h-40 w-full rounded-xl ${luxe ? "luxe-gold-shimmer" : "shimmer-block"}`} />
          <div className={`h-24 w-full rounded-xl ${luxe ? "luxe-gold-shimmer opacity-80" : "shimmer-block"}`} />
        </div>
      </div>
    );
  }

  const panelClass =
    luxe
      ? "overflow-hidden rounded-xl border border-[#d4af37]/25 bg-[#0d0b09] shadow-inner"
      : "overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-[#0b0b0e] dark:shadow-none";

  const headerRow = (
    <div
      className={
        luxe
          ? "border-b border-[#d4af37]/20 px-4 py-2 text-xs text-[#c4b49a]"
          : "border-b border-zinc-200/90 px-4 py-2 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400"
      }
    >
      Generated component (streamed)
      {isStreaming ? (
        <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          live
        </span>
      ) : null}
    </div>
  );

  const body = (
    <div className={luxe ? "bg-[#050403]" : "bg-zinc-950"}>
      <SyntaxHighlighter
        language="tsx"
        style={oneDark}
        customStyle={{
          margin: 0,
          background: "transparent",
          fontSize: "0.82rem",
          maxHeight: "28rem",
        }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );

  /* Luxe + streaming: skip spring entrance so flushSync chunk updates paint immediately. */
  if (luxe && isStreaming) {
    return (
      <div className={panelClass}>
        {headerRow}
        {body}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ y: 48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className={panelClass}
    >
      {headerRow}
      {body}
    </motion.div>
  );
}
