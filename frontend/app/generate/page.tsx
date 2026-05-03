import type { Metadata } from "next";
import { Suspense } from "react";
import { GeneratePageClient } from "./GeneratePageClient";

export const metadata: Metadata = {
  title: "Workspace",
};

export default function GeneratePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-100 text-sm text-zinc-600 dark:bg-[#050505] dark:text-zinc-400">
          Opening workspace…
        </div>
      }
    >
      <GeneratePageClient />
    </Suspense>
  );
}
