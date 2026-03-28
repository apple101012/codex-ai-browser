/**
 * Regex pattern for CSS selector meta-characters that need escaping in attribute values.
 * Used in fillForm fast-path (page.evaluate) and slow-path (Playwright locators).
 * Keep this in sync with usages in playwrightRuntime.ts.
 */
export const CSS_ESCAPE_PATTERN = /["'\\[\](){}|^$*+?.:#~>,]/g;

/**
 * Escape a string for safe use inside CSS attribute selectors (e.g., `[name="..."]`).
 * This is the canonical implementation — the same regex is duplicated inside
 * page.evaluate() calls (which can't import modules), so keep them in sync.
 */
export function cssEscape(s: string): string {
  return s.replace(CSS_ESCAPE_PATTERN, (c) => `\\${c}`);
}
