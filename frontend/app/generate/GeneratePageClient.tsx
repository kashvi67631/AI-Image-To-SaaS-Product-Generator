"use client";

import { useSearchParams } from "next/navigation";
import { DesignerWorkspace } from "@/components/features/workspace/DesignerWorkspace";
import { DesignerWorkspaceErrorBoundary } from "@/components/features/workspace/DesignerWorkspaceErrorBoundary";

/** Same `layoutId` family as landing workspace for shared-motion prompt chrome (optional). */
const LUXE_PROMPT_LAYOUT_ID = "luxegen-prompt-shell";

export function GeneratePageClient() {
  const searchParams = useSearchParams();
  const prompt = searchParams.get("prompt") ?? "";
  const trimmed = prompt.trim();

  return (
    <div className="luxe-dashboard-shell relative isolate flex min-h-screen w-full flex-col overflow-hidden selection:bg-amber-100/80 dark:selection:bg-amber-900/30">
      <DesignerWorkspaceErrorBoundary>
        <DesignerWorkspace
          autoRunPrompt={trimmed || undefined}
          autoRunKey={searchParams.toString()}
          useFloatingPromptBar
          overlayOnHeroGradient
          heroToWorkspaceLayoutId={LUXE_PROMPT_LAYOUT_ID}
          animateCanvasEntrance
        />
      </DesignerWorkspaceErrorBoundary>
    </div>
  );
}
