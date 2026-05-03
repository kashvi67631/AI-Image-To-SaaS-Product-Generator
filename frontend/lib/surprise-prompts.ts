/** Curated starters for the landing “Surprise me” action. */
export const SURPRISE_PROMPTS: readonly string[] = [
  "A minimalist jewelry lookbook: serif headlines, champagne gold dividers, and a soft cream canvas.",
  "High-end real estate listing hero with full-bleed imagery, thin caps navigation, and a single elegant CTA.",
  "Luxury skincare product detail page with ingredient storytelling, muted sage accents, and lots of whitespace.",
  "Private banking dashboard: dark walnut sidebar, small caps labels, and restrained chart cards.",
  "Boutique hotel booking flow: large imagery, date picker as a focal card, and warm stone typography.",
  "Watchmaker editorial layout: oversized product crop, technical specs in a slim two-column grid.",
  "Members-only wine club: cellar-toned palette, tasting notes as cards, and subtle foil-like highlights.",
  "Art gallery exhibition page: dramatic type scale, exhibition dates as a ribbon, and image-dominant grid.",
];

export function pickRandomSurprisePrompt(): string {
  const i = Math.floor(Math.random() * SURPRISE_PROMPTS.length);
  return SURPRISE_PROMPTS[i] ?? SURPRISE_PROMPTS[0];
}
