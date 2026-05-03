import type { Transform } from "sucrase";
import { transform } from "sucrase";

/** Same order as react-live `renderElementAsync` (noInline). */
const REACT_LIVE_TRANSFORMS: Transform[] = ["jsx", "typescript", "imports"];

/**
 * True if streamed live code should pass react-live's sucrase step (no thrown transform errors).
 */
export function isLivePreviewCodeCompilable(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) {
    return false;
  }
  if (!/render\s*\(/.test(trimmed)) {
    return false;
  }
  try {
    transform(trimmed, { transforms: REACT_LIVE_TRANSFORMS });
    return true;
  } catch {
    return false;
  }
}

/** Matches react-live / sucrase messages we should not surface as a red box during streaming. */
export function isLikelyTranspileSyntaxError(errorText: string): boolean {
  const m = errorText.toLowerCase();
  return (
    m.includes("syntaxerror") ||
    m.includes("unexpected token") ||
    m.includes("unexpected end of input") ||
    m.includes("unexpected eof") ||
    m.includes("unexpected reserved word") ||
    (m.includes("unexpected") && m.includes("expected"))
  );
}
