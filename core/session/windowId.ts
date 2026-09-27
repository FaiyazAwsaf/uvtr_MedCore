/**
 * A stable identity for this browsing context (window, tab or Demo Wall
 * iframe). `window.name` survives reloads and navigation and is never shared
 * between iframes, so it keys per-window session state (plan §3.9).
 * window.open(url, "mc-...") and <iframe name="mc-..."> set it explicitly.
 */
export function windowKey(): string {
  if (typeof window === "undefined") return "server"
  if (!window.name || !window.name.startsWith("mc-")) {
    const random = Math.random().toString(36).slice(2, 10)
    window.name = `mc-${random}`
  }
  return window.name
}
