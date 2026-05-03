import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** Prop metadata for the generated component (documentation + typing hints). */
export const propDefinitionSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  defaultValue: z.string().optional(),
  description: z.string(),
});

/** Structured output: TSX source plus metadata clients can use without executing code. */
export const reactComponentResultSchema = z.object({
  componentName: z
    .string()
    .describe("PascalCase name of the single React component"),
  description: z.string().describe("Short summary of what the UI shows"),
  styling: z
    .enum(["tailwind", "inline", "css-module", "none"])
    .describe("Primary styling approach used in sourceCode"),
  props: z.array(propDefinitionSchema).describe("Props for the component"),
  sourceCode: z
    .string()
    .describe(
      "Complete TSX for one default-exported function component. No markdown fences.",
    ),
  accessibilityNotes: z
    .string()
    .optional()
    .describe("ARIA roles, labels, or focus notes if relevant"),
});

export type ReactComponentResult = z.infer<typeof reactComponentResultSchema>;

export function getReactComponentJsonSchema(): Record<string, unknown> {
  // zod v4 vs zod-to-json-schema typings: runtime shape is valid.
  return zodToJsonSchema(reactComponentResultSchema as never, {
    name: "ReactComponentResult",
    $refStrategy: "none",
  }) as Record<string, unknown>;
}
