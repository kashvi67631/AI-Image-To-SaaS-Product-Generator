/** react-live bundle: strip imports, drop default export keyword, append render(). */

const WAITING_LIVE_CODE = `const Waiting = () => (
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

function extractStreamError(source: string): string | null {
  const match = source.match(/\/\*\s*Error:\s*([\s\S]*?)\s*\*\//);
  return match?.[1]?.trim() || null;
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
  const stripped = source
    .replace(/```[a-zA-Z0-9_-]*\s*/g, "")
    .replace(/```/g, "")
    .trim();
  // Some streamed outputs leave a dangling language token on first line.
  return stripped.replace(/^(tsx|jsx|typescript|javascript)\s*\n/i, "");
}

/** RSC directives break react-live's eval; streamed Next code often includes them. */
function stripRscDirectives(source: string): string {
  return source
    .replace(/^\s*["']use client["']\s*;?\s*/gim, "")
    .replace(/^\s*["']use server["']\s*;?\s*/gim, "");
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
  const cleaned = stripRscDirectives(stripMarkdownFences(raw));
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
  const sanitized = stripRscDirectives(stripMarkdownFences(raw));
  const streamError = extractStreamError(sanitized);
  const hasDefaultExport =
    /export\s+default\s+function\s+\w+\s*[<(]/.test(sanitized) ||
    /export\s+default\s+\w+\s*;?/.test(sanitized);
  const importedModules = extractImportedModules(sanitized);
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
  const cleaned = stripRscDirectives(stripMarkdownFences(raw));
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
 * Turn raw streamed TSX into react-live code. Uses safe placeholders until
 * a default-export function is present so the preview never receives totally empty code.
 */
export function prepareStreamedCodeForLive(
  raw: string,
  options?: PrepareStreamedLiveOptions,
): string {
  const cleaned = stripRscDirectives(stripMarkdownFences(raw));
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
  let withoutImports = stripViewportHeightCaps(stripImportLines(cleaned)).trim();
  if (!withoutImports) {
    return WAITING_LIVE_CODE;
  }

  const forceRender = Boolean(options?.forceRender);
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
    return `${body}\n\nrender(<${componentName} />);`;
  }

  const jsxStart = withoutImports.indexOf("<");
  const jsxEnd = withoutImports.lastIndexOf(">");
  const hasLikelyJsxFragment = jsxStart >= 0 && jsxEnd > jsxStart;
  if (hasLikelyJsxFragment) {
    const jsxFragment = withoutImports.slice(jsxStart, jsxEnd + 1).trim();
    return `render(
  <div className="min-h-[12rem]">
    ${jsxFragment}
  </div>
);`;
  }

  if (forceRender) {
    const wrapped = wrapInTemporaryDefaultExport(stripViewportHeightCaps(stripImportLines(cleaned)).trim());
    const wStripped = stripImportLines(wrapped).trim();
    const forcedName =
      wStripped.match(/export\s+default\s+function\s+(\w+)\s*[<(]/)?.[1] || "__StreamPartialPreview";
    const body = wStripped
      .replace(/export\s+default\s+function\s+/g, "function ")
      .replace(/export\s+default\s+/g, "");
    return `${body}\n\nrender(<${forcedName} />);`;
  }

  return `const Composing = () => (
  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
    <p className="font-semibold">Streaming in progress</p>
    <p className="mt-1">Preview will render automatically when JSX becomes complete.</p>
  </div>
);
render(<Composing />);`;
}
