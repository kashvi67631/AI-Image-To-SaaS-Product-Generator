import { GoogleGenAI } from "@google/genai";
import {
  getReactComponentJsonSchema,
  reactComponentResultSchema,
  type ReactComponentResult,
} from "./schema.js";

const VISION_PROMPT = `You are a senior React (TypeScript + TSX) developer.
Analyze the attached image and implement a single UI that matches it as closely as reasonable.

Rules:
- Output must follow the JSON schema exactly.
- sourceCode must be valid TSX: one default-exported function component, no extraneous prose.
- Prefer semantic HTML and accessible patterns (labels, alt text, roles where needed).
- Use Tailwind utility classes when they keep the code clear; otherwise minimal inline styles are OK.
- Do not use placeholder comments like "// add logic"; write a complete component.
- Do not wrap sourceCode in markdown code fences inside the string.`;

export async function imageToStructuredReact(params: {
  apiKey: string;
  model: string;
  imageBase64: string;
  mimeType: string;
}): Promise<ReactComponentResult> {
  const { apiKey, model, imageBase64, mimeType } = params;
  const ai = new GoogleGenAI({ apiKey });
  const responseJsonSchema = getReactComponentJsonSchema();

  const response = await ai.models.generateContent({
    model,
    contents: {
      role: "user",
      parts: [
        { text: VISION_PROMPT },
        {
          inlineData: {
            mimeType,
            data: imageBase64,
          },
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseJsonSchema,
      temperature: 0.4,
    },
  });

  const raw = response.text;
  if (!raw) {
    const reason =
      response.promptFeedback?.blockReason ??
      response.candidates?.[0]?.finishReason ??
      "empty response";
    throw new Error(`Gemini returned no text: ${String(reason)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model response was not valid JSON");
  }

  return reactComponentResultSchema.parse(parsed);
}
