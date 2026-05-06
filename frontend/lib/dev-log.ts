/** True in local `next dev` / non-production builds. */
export const isDevEnvironment = process.env.NODE_ENV === "development";

export function devLog(...args: unknown[]): void {
  if (isDevEnvironment) {
    console.log(...args);
  }
}

export function devInfo(...args: unknown[]): void {
  if (isDevEnvironment) {
    console.info(...args);
  }
}

export function devWarn(...args: unknown[]): void {
  if (isDevEnvironment) {
    console.warn(...args);
  }
}
