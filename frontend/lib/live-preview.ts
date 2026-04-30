/** react-live bundle: strip imports, drop default export keyword, append render(). */

export const LIVE_PREVIEW_WAITING_CODE = `const Waiting = () => (
  <div className="flex min-h-[12rem] items-center justify-center text-sm text-zinc-500">
    Waiting for streamed code…
  </div>
);
render(<Waiting />);`;

/** Placeholder live code when service is overloaded (parent may show Retry in chrome). */
const SERVER_BUSY_LIVE_CODE = `const ServerBusy = () => (
  <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 text-center text-sm text-zinc-500">
    <p className="font-medium text-zinc-700 dark:text-zinc-300">Service busy</p>
    <p className="text-xs">Use Retry in the preview header.</p>
  </div>
);
render(<ServerBusy />);`;

const STREAMING_COMPOSING_MARKER = "Streaming in progress";

function extractStreamError(source: string): string | null {
  const match = source.match(/\/\*\s*Error:\s*([\s\S]*?)\s*\*\//);
  return match?.[1]?.trim() || null;
}

/** Remove markdown code fences as soon as they appear (incremental stream safe). */
function removeStreamCodeFences(stream: string): string {
  return stream
    .replace(/```(?:jsx|tsx|javascript|typescript|js|ts)?\s*\n?/gi, "")
    .replace(/```/g, "")
    .replace(/^[`]{1,2}(?:jsx|tsx|js|ts|javascript|typescript)?\s*$/gim, "")
    .trim();
}

/** Remove stray markdown/punctuation prefix (e.g. leading ` or . from stream). */
function stripLeadingStreamNoiseChars(source: string): string {
  return source.replace(/^\s*[`.]+(?=\s*(?:<|import|export|function|const|let|var))/i, "");
}

/**
 * Strip any non-alphanumeric prefix from the first meaningful line before code begins.
 * Useful when stream starts with stray punctuation like `.`, `` ` ``, or `-`.
 */
function stripFirstLineNonAlphaPrefix(source: string): string {
  const lines = source.split("\n");
  const startRegex = /^\s*(?:import|export|function|const|let|var|class|type|interface|<)/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      continue;
    }
    const cleaned = line.replace(/^\s*[^A-Za-z0-9<]+/, "");
    lines[i] = cleaned;
    if (startRegex.test(cleaned)) {
      break;
    }
  }
  return lines.join("\n");
}

/**
 * If first 50 chars contain punctuation noise before import/export/const, strip it aggressively.
 */
function stripAggressivePrefixBeforeCodeKeyword(source: string): string {
  const firstWindow = source.slice(0, 50);
  const keywordIdx = firstWindow.search(/\b(?:import|export|const)\b/);
  if (keywordIdx <= 0) {
    return source;
  }
  const prefix = firstWindow.slice(0, keywordIdx);
  if (/[^A-Za-z0-9\s]/.test(prefix)) {
    return `${source.slice(keywordIdx)}`.trimStart();
  }
  return source;
}

function findMatchingBraceIndex(source: string, startBraceIdx: number): number {
  let depth = 0;
  for (let i = startBraceIdx; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Strict mode: trim any explanation/noise that appears after main component close.
 */
function trimAfterMainComponentBlock(source: string): string {
  const exportFnMatch = source.match(/export\s+default\s+function\s+\w+[^{]*\{/);
  if (exportFnMatch?.index !== undefined) {
    const openBraceIdx = exportFnMatch.index + exportFnMatch[0].lastIndexOf("{");
    const closeBraceIdx = findMatchingBraceIndex(source, openBraceIdx);
    if (closeBraceIdx >= 0) {
      return source.slice(0, closeBraceIdx + 1).trim();
    }
  }

  const fnDeclMatch = source.match(/\bfunction\s+([A-Za-z_$][\w$]*)\s*[^(]*\([^)]*\)\s*\{/);
  if (fnDeclMatch?.index !== undefined) {
    const openBraceIdx = fnDeclMatch.index + fnDeclMatch[0].lastIndexOf("{");
    const closeBraceIdx = findMatchingBraceIndex(source, openBraceIdx);
    if (closeBraceIdx >= 0) {
      let end = closeBraceIdx + 1;
      const exportDefaultMatch = source.slice(end).match(/^\s*export\s+default\s+[A-Za-z_$][\w$]*\s*;?/);
      if (exportDefaultMatch?.index === 0) {
        end += exportDefaultMatch[0].length;
      }
      return source.slice(0, end).trim();
    }
  }

  const exportDefaultLine = source.match(/\n?\s*export\s+default\s+[A-Za-z_$][\w$]*\s*;?/m);
  if (exportDefaultLine?.index !== undefined) {
    const end = exportDefaultLine.index + exportDefaultLine[0].length;
    return source.slice(0, end).trim();
  }

  return source;
}

function splitTopLevelJsxNodes(source: string): string[] {
  const text = source.trim();
  const nodes: string[] = [];
  let depth = 0;
  let inTag = false;
  let nodeStart = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "<") {
      if (depth === 0 && nodeStart === -1) {
        nodeStart = i;
      }
      inTag = true;
      if (!text.startsWith("</", i) && !text.startsWith("<!", i) && !text.startsWith("<?", i)) {
        depth += 1;
      } else if (text.startsWith("</", i)) {
        depth -= 1;
      }
    } else if (ch === ">" && inTag) {
      inTag = false;
      if (text[i - 1] === "/" && depth > 0) {
        depth -= 1;
      }
      if (depth === 0 && nodeStart >= 0) {
        nodes.push(text.slice(nodeStart, i + 1).trim());
        nodeStart = -1;
      }
    }
  }
  return nodes.filter(Boolean);
}

function wrapMultipleTopLevelJsx(source: string): string {
  const trimmed = source.trim();
  if (!trimmed.startsWith("<")) {
    return source;
  }
  const nodes = splitTopLevelJsxNodes(trimmed);
  if (nodes.length <= 1) {
    return source;
  }
  return `<>${nodes.join("\n")}</>`;
}

/**
 * Strip leading prose / markdown that is not TS/JS/JSX (explanations before the code).
 */
function stripLeadingNonCodeLines(text: string): string {
  const lines = text.split("\n");
  const looksLikeCode = (line: string): boolean => {
    const t = line.trim();
    if (!t) return false;
    return (
      /^\s*(?:import\s|export\s|function\s|const\s|let\s|var\s|type\s|interface\s|return\s|\/\/|\/\*)/.test(line) ||
      /[<>()[\]{};=]/.test(line) ||
      /^[@$A-Za-z_][\w$]*\s*[:=]/.test(line)
    );
  };
  let start = 0;
  while (start < lines.length) {
    const line = lines[start] ?? "";
    if (line.trim() === "") {
      start += 1;
      continue;
    }
    if (looksLikeCode(line)) break;
    if (/^\s*(?:#{1,6}\s|>\s|[-*+]\s|\d+\.\s)/.test(line)) {
      start += 1;
      continue;
    }
    break;
  }
  return lines.slice(start).join("\n");
}

/** Regex pass: drop obvious non-code tokens (lone bullets, markdown headers mid-stream). */
function stripNonCodeNoiseWithRegex(text: string): string {
  return text
    .replace(/^\s*#{1,6}\s[^\n]*\n/gm, "")
    .replace(/^\s*>\s[^\n]*\n/gm, "")
    .replace(/\n{4,}/g, "\n\n");
}

/** Brace depth within a line (for multiline import blocks). */
function braceDelta(line: string): number {
  let depth = 0;
  for (const ch of line) {
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
    }
  }
  return depth;
}

/**
 * Remove import lines and blocks (including multiline `import { ... } from "x"`).
 * Line-only filters leave orphan `}` / identifiers and break react-live parsing.
 */
function stripImportLines(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let skipping = false;
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!skipping) {
      if (/^\s*import(?:\s+|\{)/.test(line)) {
        skipping = true;
        depth = braceDelta(line);
        if (trimmed.endsWith(";") && depth <= 0) {
          skipping = false;
        }
        continue;
      }
      out.push(line);
      continue;
    }

    depth += braceDelta(line);
    if (trimmed.endsWith(";") && depth <= 0) {
      skipping = false;
    }
  }

  return out.join("\n");
}

function stripViewportHeightCaps(source: string): string {
  return source
    .replace(/\bmax-h-screen\b/g, "")
    .replace(/\bmax-h-\[100vh\]\b/g, "")
    .replace(/maxHeight\s*:\s*["'`]100vh["'`]\s*,?/g, "")
    .replace(/max-height\s*:\s*100vh\s*;?/gi, "");
}

function stripMarkdownFences(source: string): string {
  return removeStreamCodeFences(source).replace(/^(tsx|jsx|typescript|javascript)\s*\n/i, "");
}

/** RSC directives break react-live's eval; streamed Next code often includes them. */
function stripRscDirectives(source: string): string {
  return source
    .replace(/^\s*["']use client["']\s*;?\s*/gim, "")
    .replace(/^\s*["']use server["']\s*;?\s*/gim, "");
}

function wrapAsDefaultFunctionalComponent(body: string): string {
  const b = body.trim();
  if (!b) return body;
  const indented = b
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");
  return `function StreamPreview() {
  return (
    <>
${indented}
    </>
  );
}

export default StreamPreview;
`;
}

/**
 * Sanitize streamed text: strip fences immediately, drop prose/noise, strip RSC/imports where needed,
 * optionally wrap as a default-export component when there is JSX-like content but no export default.
 */
export function sanitizeCode(streamChunk: string): string {
  if (!streamChunk) return streamChunk;
  let out = removeStreamCodeFences(streamChunk);
  out = stripLeadingStreamNoiseChars(out);
  out = stripFirstLineNonAlphaPrefix(out);
  out = stripAggressivePrefixBeforeCodeKeyword(out);
  out = stripRscDirectives(out);
  out = stripLeadingNonCodeLines(out);
  out = stripNonCodeNoiseWithRegex(out);
  out = stripImportLines(out);
  out = stripViewportHeightCaps(out);
  out = trimAfterMainComponentBlock(out);
  out = out.replace(/\n{3,}/g, "\n\n").trim();

  if (!out) return out;
  if (!/export\s+default\s+/m.test(out)) {
    const couldBeJsxOnly =
      /^\s*</.test(out) ||
      /\n\s*</.test(out) ||
      (/<[A-Za-z][\w-]*/.test(out) && !/^\s*(?:function|const|let|var|class)\s+/m.test(out));
    const hasDeclaredComponent =
      /\bfunction\s+[A-Za-z_$][\w$]*\s*[<(]/.test(out) ||
      /\bconst\s+[A-Za-z_$][\w$]*\s*=\s*(?:\([^)]*\)\s*=>|\([^)]*\)\s*:\s*)/.test(out);
    if (couldBeJsxOnly && !hasDeclaredComponent) {
      out = wrapAsDefaultFunctionalComponent(wrapMultipleTopLevelJsx(out));
    }
  }
  return out;
}

function detectLastComponentSymbol(source: string): string | null {
  const names: string[] = [];
  for (const m of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*[<(]/g)) {
    if (m[1]) {
      names.push(m[1]);
    }
  }
  for (const m of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    if (m[1]) {
      names.push(m[1]);
    }
  }
  return names.length ? names[names.length - 1] : null;
}

/** Resolve which identifier to render() after ensureDefaultExport runs. */
function extractDefaultExportName(source: string): string | null {
  const fromFn = source.match(/export\s+default\s+function\s+(\w+)\s*[<(]/);
  if (fromFn?.[1]) {
    return fromFn[1];
  }
  const fromIdent = source.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*(?:;|\s*$)/m);
  if (fromIdent?.[1]) {
    return fromIdent[1];
  }
  return null;
}

/**
 * Appends a default export to streamed code when missing, so preview can keep rendering
 * during partial generations instead of blanking.
 */
export function appendMissingDefaultExport(raw: string): string {
  const cleaned = sanitizeCode(raw);
  if (!cleaned.trim()) {
    return cleaned;
  }
  if (/export\s+default\s+/.test(cleaned)) {
    return cleaned;
  }
  const inferred = detectLastComponentSymbol(cleaned);
  if (inferred) {
    return `${cleaned}\n\nexport default ${inferred};`;
  }
  return `${cleaned}

function GeneratedComponent() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      Generated code is incomplete. Keep streaming for full render.
    </div>
  );
}

export default GeneratedComponent;`;
}

function ensureDefaultExport(source: string): string {
  if (/export\s+default\s+/.test(source)) {
    return source;
  }

  const fnMatch = source.match(/\bfunction\s+([A-Za-z_]\w*)\s*[<(]/);
  if (fnMatch?.[1]) {
    return `${source}\n\nexport default ${fnMatch[1]};`;
  }

  const constMatch = source.match(/\bconst\s+([A-Za-z_]\w*)\s*=/);
  if (constMatch?.[1]) {
    return `${source}\n\nexport default ${constMatch[1]};`;
  }

  return `${source}

function GeneratedComponent() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      Generated code is incomplete. Keep streaming for full render.
    </div>
  );
}

export default GeneratedComponent;`;
}

const PREVIEW_ALLOWED_IMPORTS = new Set([
  "react",
  "lucide-react",
  "framer-motion",
]);

function extractImportedModules(source: string): string[] {
  const modules: string[] = [];
  const regex = /^\s*import\s+[^'"]*['"]([^'"]+)['"]\s*;?\s*$/gm;
  for (const match of source.matchAll(regex)) {
    if (match[1]) {
      modules.push(match[1]);
    }
  }
  return modules;
}

export function analyzePreviewCodeIssues(raw: string): {
  hasDefaultExport: boolean;
  unsupportedImports: string[];
  streamError: string | null;
} {
  const sanitized = sanitizeCode(raw);
  const streamError = extractStreamError(sanitized);
  const hasDefaultExport =
    /export\s+default\s+function\s+\w+\s*[<(]/.test(sanitized) ||
    /export\s+default\s+\w+\s*;?/.test(sanitized);
  const forImportScan = removeStreamCodeFences(stripRscDirectives(raw));
  const importedModules = extractImportedModules(forImportScan);
  const unsupportedImports = importedModules.filter(
    (name) => !PREVIEW_ALLOWED_IMPORTS.has(name),
  );
  return { hasDefaultExport, unsupportedImports, streamError };
}

export function toReactLiveRenderableCode(sourceCode: string, componentName: string): string {
  const stripped = stripViewportHeightCaps(stripImportLines(stripMarkdownFences(sourceCode)))
    .replace(/export\s+default\s+function\s+/g, "function ")
    .replace(/export\s+default\s+/g, "");
  return `${stripped}\n\nrender(<${componentName} />);`;
}

export type PrepareStreamedLiveOptions = {
  /** Wrap incomplete stream in a temporary default export to attempt partial render. */
  forceRender?: boolean;
};

function isUnavailableServiceError(text: string): boolean {
  const t = text.toUpperCase();
  return (
    t.includes("UNAVAILABLE") ||
    t.includes("HIGH DEMAND") ||
    t.includes('"STATUS":"UNAVAILABLE"') ||
    t.includes("SERVICE UNAVAILABLE")
  );
}

/** Detect Gemini/stream errors embedded in streamed text (e.g. after non-JSON error path). */
export function detectStreamUnavailableInText(raw: string): boolean {
  const cleaned = sanitizeCode(raw);
  if (extractStreamError(cleaned) && isUnavailableServiceError(cleaned)) {
    return true;
  }
  return isUnavailableServiceError(cleaned);
}

function indentBlock(body: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return body
    .split("\n")
    .map((line) => (line.trim() === "" ? line : pad + line))
    .join("\n");
}

function hasOddUnescapedChar(source: string, target: "'" | '"' | "`"): boolean {
  let count = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== target) {
      continue;
    }
    let backslashes = 0;
    let j = i - 1;
    while (j >= 0 && source[j] === "\\") {
      backslashes += 1;
      j -= 1;
    }
    if (backslashes % 2 === 0) {
      count += 1;
    }
  }
  return count % 2 === 1;
}

function hasLikelyIncompleteSyntax(source: string): boolean {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (const ch of source) {
    if (ch === "(") paren += 1;
    if (ch === ")") paren -= 1;
    if (ch === "{") brace += 1;
    if (ch === "}") brace -= 1;
    if (ch === "[") bracket += 1;
    if (ch === "]") bracket -= 1;
    if (paren < 0 || brace < 0 || bracket < 0) {
      return true;
    }
  }
  if (paren !== 0 || brace !== 0 || bracket !== 0) {
    return true;
  }
  if (
    hasOddUnescapedChar(source, "'") ||
    hasOddUnescapedChar(source, '"') ||
    hasOddUnescapedChar(source, "`")
  ) {
    return true;
  }
  return /(?:\b(?:function|const|let|var|return|export)\s*)$/.test(source.trimEnd());
}

function closeUnbalancedPairs(source: string): string {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let doubleQuoteOpen = false;
  let singleQuoteOpen = false;
  let templateQuoteOpen = false;
  let escaped = false;
  for (const ch of source) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"' && !singleQuoteOpen && !templateQuoteOpen) {
      doubleQuoteOpen = !doubleQuoteOpen;
      continue;
    }
    if (ch === "'" && !doubleQuoteOpen && !templateQuoteOpen) {
      singleQuoteOpen = !singleQuoteOpen;
      continue;
    }
    if (ch === "`" && !doubleQuoteOpen && !singleQuoteOpen) {
      templateQuoteOpen = !templateQuoteOpen;
      continue;
    }
    if (doubleQuoteOpen || singleQuoteOpen || templateQuoteOpen) {
      continue;
    }
    if (ch === "(") paren += 1;
    if (ch === ")") paren -= 1;
    if (ch === "{") brace += 1;
    if (ch === "}") brace -= 1;
    if (ch === "[") bracket += 1;
    if (ch === "]") bracket -= 1;
  }
  const quoteFix = `${doubleQuoteOpen ? '"' : ""}${singleQuoteOpen ? "'" : ""}${templateQuoteOpen ? "`" : ""}`;
  return `${source}${quoteFix}${")".repeat(Math.max(paren, 0))}${"]".repeat(Math.max(bracket, 0))}${"}".repeat(Math.max(brace, 0))}`;
}

/**
 * Count open vs closed HTML-like tags and append temporary closing tags so partial JSX is balanced.
 * (Focused on streaming where `</div>` arrives late.)
 */
export function appendTemporaryClosingTagsForOpenElements(source: string): string {
  const tagRegex = /<\/?([A-Za-z][\w:-]*)(?:\s[^<>]*?)?>/g;
  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  const stack: string[] = [];
  for (const match of source.matchAll(tagRegex)) {
    const full = match[0] ?? "";
    const tag = match[1]?.toLowerCase();
    if (!tag) continue;
    if (full.startsWith("</")) {
      const idx = stack.lastIndexOf(tag);
      if (idx >= 0) stack.splice(idx, 1);
      continue;
    }
    if (full.endsWith("/>") || voidTags.has(tag)) {
      continue;
    }
    stack.push(tag);
  }
  let fixed = source;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    fixed += `</${stack[i]}>`;
  }
  return fixed;
}

function applyPermissiveStreamFixes(preSanitized: string): string {
  let fixed = preSanitized.trim();
  fixed = fixed.replace(/export\s+default\s*$/m, "").replace(/export\s*$/m, "");
  fixed = appendTemporaryClosingTagsForOpenElements(fixed);
  fixed = closeUnbalancedPairs(fixed);
  return fixed;
}

function buildSafeRenderBlock(componentName: string): string {
  return `try {
  render(<${componentName} />);
} catch (_previewErr) {
  const __Fallback = () => (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      Rendering partial preview while stream completes.
    </div>
  );
  render(<__Fallback />);
}`;
}

function composingLiveCode(message?: string): string {
  const subtitle =
    message || "Preview will render automatically when JSX becomes complete.";
  const safeSubtitle = JSON.stringify(subtitle);
  return `const Composing = () => (
  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
    <p className="font-semibold">${STREAMING_COMPOSING_MARKER}</p>
    <p className="mt-1">{${safeSubtitle}}</p>
  </div>
);
render(<Composing />);`;
}

export function isPlaceholderOrWaitingLiveCode(code: string): boolean {
  return (
    code.includes(STREAMING_COMPOSING_MARKER) ||
    code.includes("Waiting for streamed code") ||
    code.includes("Waiting for streamed code…")
  );
}

/**
 * Wrap raw streamed body in a single component + export default for force-preview attempts.
 */
function wrapInTemporaryDefaultExport(withoutImports: string): string {
  const inner = indentBlock(withoutImports.trim(), 6);
  return `function __StreamPartialPreview() {
  return (
    <>
${inner}
    </>
  );
}

export default __StreamPartialPreview;`;
}

/**
 * Input should already be sanitized + default export completed (e.g. appendMissingDefaultExport).
 * Turn TSX into react-live code with safe placeholders until runnable.
 */
export function prepareStreamedCodeForLive(
  normalizedRaw: string,
  options?: PrepareStreamedLiveOptions,
): string {
  const cleaned = normalizedRaw.trim();
  const streamError = extractStreamError(cleaned);
  if (streamError) {
    if (isUnavailableServiceError(streamError)) {
      return SERVER_BUSY_LIVE_CODE;
    }
    const safeMessage = JSON.stringify(streamError);
    return `const StreamError = () => (
  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
    <p className="font-semibold">Generation failed</p>
    <p className="mt-1 break-words">{${safeMessage}}</p>
  </div>
);
render(<StreamError />);`;
  }
  if (isUnavailableServiceError(cleaned)) {
    return SERVER_BUSY_LIVE_CODE;
  }
  let withoutImports = applyPermissiveStreamFixes(cleaned);
  if (!withoutImports) {
    return LIVE_PREVIEW_WAITING_CODE;
  }
  const forceRender = Boolean(options?.forceRender);
  if (hasLikelyIncompleteSyntax(withoutImports) && !forceRender) {
    return composingLiveCode(
      "Generated code is still incomplete. Waiting for valid syntax before rendering.",
    );
  }
  if (hasLikelyIncompleteSyntax(withoutImports) && forceRender) {
    withoutImports = closeUnbalancedPairs(appendTemporaryClosingTagsForOpenElements(withoutImports));
  }
  const hasExport =
    /export\s+default\s+function\s+\w+\s*[<(]/.test(withoutImports) ||
    /export\s+default\s+\w+\s*;?/.test(withoutImports);

  if (forceRender && !hasExport) {
    withoutImports = wrapInTemporaryDefaultExport(withoutImports);
  }

  const withExport = ensureDefaultExport(withoutImports);
  const componentName = extractDefaultExportName(withExport);
  if (componentName) {
    const body = withExport
      .replace(/export\s+default\s+function\s+/g, "function ")
      .replace(/export\s+default\s+/g, "");
    return `${body}\n\n${buildSafeRenderBlock(componentName)}`;
  }

  const jsxStart = withoutImports.indexOf("<");
  const jsxEnd = withoutImports.lastIndexOf(">");
  const hasLikelyJsxFragment = jsxStart >= 0 && jsxEnd > jsxStart;
  if (hasLikelyJsxFragment) {
    const jsxFragment = appendTemporaryClosingTagsForOpenElements(
      withoutImports.slice(jsxStart, jsxEnd + 1).trim(),
    );
    return `try {
  render(
  <div className="min-h-[12rem]">
    ${jsxFragment}
  </div>
  );
} catch (_e) {
  render(<div className="min-h-[12rem] text-sm text-zinc-500">Preview updating…</div>);
}`;
  }

  if (forceRender) {
    const wrapped = wrapInTemporaryDefaultExport(
      stripViewportHeightCaps(stripImportLines(cleaned)).trim(),
    );
    const wStripped = stripImportLines(wrapped).trim();
    const forcedName =
      wStripped.match(/export\s+default\s+function\s+(\w+)\s*[<(]/)?.[1] || "__StreamPartialPreview";
    const body = wStripped
      .replace(/export\s+default\s+function\s+/g, "function ")
      .replace(/export\s+default\s+/g, "");
    return `${body}\n\nrender(<${forcedName} />);`;
  }

  return composingLiveCode();
}
