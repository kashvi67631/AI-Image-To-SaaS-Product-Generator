import { GoogleGenAI } from "@google/genai";
import type { Response } from "express";
import { designStyleDirectives } from "./design-style-directives.js";
import {
  generateRequestSchema,
  type DesignStyle,
} from "./generate-request-schema.js";

const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";
const PREFERRED_MODELS = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.5-flash"] as const;

function resolveGeminiModel(): string {
  const configured =
    process.env.GEMINI_MODEL?.trim() || process.env.GEMINI_MODEL_NAME?.trim();
  const raw = configured || DEFAULT_GEMINI_MODEL;
  return raw.replace(/^models\//, "");
}

function resolveModelCandidates(primaryModel: string): string[] {
  const candidates = [primaryModel, ...PREFERRED_MODELS];
  return candidates.filter((model, index) => candidates.indexOf(model) === index);
}

function buildUserPrompt(args: {
  prompt: string;
  previousCode?: string;
  systemInstruction: string;
}): string {
  const { prompt, previousCode, systemInstruction } = args;
  const prefix = `System instructions:\n${systemInstruction}\n\n`;
  if (previousCode?.trim()) {
    return `${prefix}Refine this existing component based on the new request. Return full updated TSX only.\n\nCurrent component:\n${previousCode}\n\nRefinement request:\n${prompt}`;
  }
  return `${prefix}${prompt}`;
}

function buildSystemInstruction(designStyle: DesignStyle): string {
  const styleLabel = designStyle.replace(/-/g, " ");
  const styleDirective = designStyleDirectives[designStyle];

  return `You are a Senior UI/UX Architect and expert React + TypeScript + Tailwind engineer. You design and ship interfaces that feel intentional, accessible, and production-ready - not generic boilerplate.

Design style for this brief: "${styleLabel}".
You MUST follow this visual direction for layout, color, typography, spacing, and decoration:
${styleDirective}

THEME-SPECIFIC TAILWIND IS LAW
- When the style block lists NON-NEGOTIABLE TAILWIND utilities, you MUST include those exact class strings (e.g. font-serif, text-amber-600, tracking-widest for luxury-minimal; rounded-2xl, bg-indigo-600, shadow-2xl for b2b-saas) on GeneratedComponent as described. Do not substitute close synonyms unless you also keep the required classes on the specified elements.

ANTI-GENERIC / ANTI-DEFAULT-PURPLE
- Do NOT fall back to a generic purple/violet-on-white minimal landing template: no violet-500/violet-600 hero gradients on white as the default look, no interchangeable SaaS purple blob backgrounds.
- Let the selected "${styleLabel}" drive palette and shape language; use stone/slate/neutral bases when the style calls for restraint, and use the mandated accent utilities from the style block.

RESPONSIVE & MOBILE-FIRST
- Build for small screens first, then enhance with sm:, md:, and lg: breakpoints.
- Use fluid spacing and typography; avoid fixed widths that break on phones.
- Ensure tap targets, readable line length, and stacks that reflow cleanly (e.g. grids that become single-column on mobile).
- Test mentally: navigation, hero, cards, and CTAs must remain usable and balanced at narrow widths.

ALLOWED LIBRARIES FOR THIS OUTPUT
- react
- lucide-react
- framer-motion
- Do NOT import any other external package or local file path.

COMPONENT CONTRACT (MANDATORY)
- Start code with: import React from "react";
- Wrap the entire UI in one component named GeneratedComponent.
- End code with exactly: export default GeneratedComponent;
- Do not emit "export default function ...".
- The output must be raw TSX only. Do not include markdown backticks or fences.

OUTPUT RULES
- Return only valid TSX for a single component file. No commentary outside the code.
- Match the user's product narrative and hierarchy; use semantic HTML and accessible patterns (landmarks, headings, aria where needed).
- Style exclusively with Tailwind utility classes so the result matches the style directive.`;
}

/**
 * Streams Gemini TSX to the Express response. Uses GEMINI_API_KEY from this process only.
 */
export async function streamPromptGenerateToResponse(
  body: unknown,
  res: Response,
): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    res.status(500).json({
      error: "Server misconfiguration: GEMINI_API_KEY is not set",
    });
    return;
  }

  let parsedBody: ReturnType<typeof generateRequestSchema.safeParse>;
  try {
    parsedBody = generateRequestSchema.safeParse(body);
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  if (!parsedBody.success) {
    res.status(400).json({
      error: "Validation failed",
      details: parsedBody.error.flatten(),
    });
    return;
  }

  const { prompt, designStyle, previousCode } = parsedBody.data;
  const modelCandidates = resolveModelCandidates(resolveGeminiModel());
  const ai = new GoogleGenAI({ apiKey, apiVersion: "v1" });
  const systemInstruction = buildSystemInstruction(designStyle);
  let activeModelName = modelCandidates[0] ?? DEFAULT_GEMINI_MODEL;

  try {
    let streamResponse: Awaited<ReturnType<typeof ai.models.generateContentStream>> | null =
      null;
    let lastError: unknown = null;

    for (const candidate of modelCandidates) {
      activeModelName = candidate;
      try {
        streamResponse = await ai.models.generateContentStream({
          model: activeModelName,
          contents: {
            role: "user",
            parts: [
              {
                text: buildUserPrompt({
                  prompt,
                  previousCode,
                  systemInstruction,
                }),
              },
            ],
          },
          config: {
            temperature: 0.5,
            maxOutputTokens: 8192,
          },
        });
        break;
      } catch (candidateError) {
        lastError = candidateError;
        const message =
          candidateError instanceof Error ? candidateError.message : String(candidateError);
        const isModelCompatibilityIssue =
          /not found|not supported|Unknown name "systemInstruction"|Developer instruction is not enabled/i.test(
            message,
          );
        if (!isModelCompatibilityIssue) {
          throw candidateError;
        }
        console.warn(`[api/generate] Model ${candidate} failed; trying next candidate.`);
      }
    }

    if (!streamResponse) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    for await (const chunk of streamResponse) {
      const text = chunk.text;
      if (text) {
        res.write(text);
      }
    }
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/generate] Generation stream failed", {
      modelName: activeModelName,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (!res.headersSent) {
      res.status(502).json({ error: message });
      return;
    }
    res.write(`\n\n/* Error: ${message} */\n`);
    res.end();
  }
}

