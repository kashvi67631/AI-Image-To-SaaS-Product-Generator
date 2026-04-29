import type { DesignStyle } from "@/lib/validation/generate-request";

/**
 * Rich, style-specific guidance appended to the system instruction so Gemini
 * outputs visibly different UI for each dropdown option.
 * Keys must match `designStyles` in generate-request.ts (e.g. luxury-minimal, b2b-saas).
 */
export const designStyleDirectives = {
  minimalist: `Apply a strict minimalist aesthetic: generous whitespace, 1-2 neutral type weights only, subtle 1px hairline dividers, almost no decoration, monochrome or near-monochrome palette (e.g. zinc/stone), one restrained accent at most. Flat surfaces, no skeuomorphism, no gradients unless barely visible. Components feel editorial and calm; prioritize clarity and hierarchy over ornament. Do NOT use violet/purple as the dominant accent unless the user explicitly asks for it - prefer slate, stone, or a single non-purple accent.`,

  "luxury-minimal": `LUXURY THEME - NON-NEGOTIABLE TAILWIND (must appear in the output)
- The outermost wrapper of GeneratedComponent MUST include: font-serif (apply on the root <main> or root <div> so the whole layout inherits serif body/headings unless you intentionally override a small sub-region).
- Primary headings, hero title, and pricing/section labels MUST use text-amber-600 (use dark:text-amber-500 in dark sections for contrast).
- Eyebrow text, kicker lines, nav brand area, and uppercase micro-labels MUST use tracking-widest.

Also apply a luxury-minimal aesthetic: deep neutral base (stone/zinc/emerald-black, not flat white), warm metallic accents beyond amber where needed, thin borders with soft highlights, restrained glass panels, premium vertical rhythm. Avoid generic "startup purple" gradients, violet-500 on white, or interchangeable minimal templates.`,

  cyberpunk: `Apply a cyberpunk / neo-noir UI: deep black or midnight blue base, neon magenta-cyan-electric blue accents, thin glow-like borders (use ring/box-shadow, not actual blur stacks), grid or scan-line hints in backgrounds, monospace touches for data or labels, high contrast and futuristic chrome details. Avoid pastel or earthy palettes; lean sharp, tech, and high-energy.`,

  "b2b-saas": `SAAS THEME - NON-NEGOTIABLE TAILWIND (must appear in the output)
- Every primary card, feature panel, pricing tier, or dashboard module MUST use rounded-2xl.
- At least one prominent primary CTA button OR hero "primary action" surface MUST use bg-indigo-600 with white text (hover: bg-indigo-700). Secondary actions may be outline styles.
- Primary elevated surfaces (hero card, main dashboard panel, or pricing highlight) MUST use shadow-2xl.

Also apply a credible B2B SaaS UI: trustworthy density, clear hierarchy, status pills, subtle borders, data-friendly layout. Prefer indigo + slate/neutral grays - not violet/purple-on-white as the default look. Avoid lazy "purple gradient on white" hero cliches unless the user asks for that exact trope.`,

  playful: `Apply a playful, friendly UI: rounded-2xl shapes, soft pastel or candy accents, bouncy spacing, optional subtle rotation or asymmetry in layout, cheerful micro-copy tone in placeholder text, illustrated-feel blocks (solid color shapes). Keep accessibility: contrast still sufficient for body text.`,

  brutalist: `Apply a brutalist / raw digital aesthetic: harsh black-white contrast or bold primaries, thick borders, visible grid, default system-adjacent typography feel, asymmetric spacing, raw rectangles, little to no shadow, "unfinished" honesty. Avoid polish, gradients, or soft glassmorphism.`,

  editorial: `Apply an editorial / magazine layout: strong typographic scale (display headings vs small captions), column-like rhythm, pull-quote or stat emphasis, serif-leaning pairing suggested via font-serif utilities where appropriate, generous vertical rhythm, art-directed whitespace, minimal chrome. Avoid default violet/purple UI kits; choose ink, paper, or a single editorial accent color.`,
} satisfies Record<DesignStyle, string>;

export function buildDesignStyleBlock(style: DesignStyle): string {
  return designStyleDirectives[style];
}
