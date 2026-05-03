import type { Metadata } from "next";
import { ThemeFlipGridOverlay } from "@/components/ThemeFlipGridOverlay";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "LuxeGen",
    template: "%s · LuxeGen",
  },
  description:
    "AI-powered luxury UI generation — prompt, stream, and refine with a live preview.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <ThemeFlipGridOverlay />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
