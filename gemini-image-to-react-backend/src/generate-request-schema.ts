import { z } from "zod";

export const designStyles = [
  "minimalist",
  "luxury-minimal",
  "cyberpunk",
  "b2b-saas",
  "playful",
  "brutalist",
  "editorial",
] as const;

export type DesignStyle = (typeof designStyles)[number];

export const generateRequestSchema = z.object({
  prompt: z.string().min(1, "Prompt is required").max(16_000, "Prompt is too long"),
  designStyle: z.enum(designStyles),
  previousCode: z.string().max(200_000, "Previous code is too long").optional(),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;
