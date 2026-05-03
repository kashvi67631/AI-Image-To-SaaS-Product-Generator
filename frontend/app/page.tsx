import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "LuxeGen — AI-Powered Luxury UI",
  description:
    "Prompt, iterate, and refine — your live preview updates as components take shape.",
};

export default function Home() {
  return <LandingPage />;
}
