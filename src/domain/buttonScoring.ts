/**
 * Pure scoring/matching logic extracted from submitPrompt and advanceForm
 * page.evaluate() calls. These functions run in Node for testing, and the
 * same logic is duplicated inside page.evaluate() in playwrightRuntime.ts.
 */

export interface ButtonCandidate {
  innerText: string;
  ariaLabel: string;
  value?: string;
  visible: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

export interface SubmitScoringResult {
  index: number;
  text: string;
  score: number;
  total: number;
}

const SUBMIT_KEYWORDS = ["create", "generate", "submit", "run", "send"];

/**
 * Score candidates for submitPrompt. Returns the best match.
 * Mirrors the logic inside submitPrompt's page.evaluate().
 */
export function scoreSubmitCandidates(
  candidates: ButtonCandidate[],
  promptCenter?: { x: number; y: number }
): SubmitScoringResult {
  let bestIndex = -1;
  let bestScore = -Infinity;
  let bestText = "";
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i]!;
    if (!el.visible) continue;
    if (el.rect.width <= 0 || el.rect.height <= 0) continue;
    const search = (el.innerText + " " + el.ariaLabel).toLowerCase();
    if (!SUBMIT_KEYWORDS.some(k => search.includes(k))) continue;
    let score = 0;
    if (search.includes("create")) score += 30000;
    if (search.includes("generate")) score += 30000;
    if (promptCenter) {
      const cx = el.rect.x + el.rect.width / 2;
      const cy = el.rect.y + el.rect.height / 2;
      const dist = Math.sqrt((cx - promptCenter.x) ** 2 + (cy - promptCenter.y) ** 2);
      score += Math.max(0, 20000 - dist * 10);
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
      bestText = el.innerText || el.ariaLabel;
    }
  }
  return { index: bestIndex, text: bestText, score: bestScore, total: candidates.length };
}

/**
 * Find the best "advance" button from candidates.
 * Returns the index or -1 if none found.
 * Mirrors the logic inside advanceForm's page.evaluate().
 */
export function findAdvanceButton(
  candidates: ButtonCandidate[],
  advanceTexts: string[],
  forbiddenTexts: string[]
): number {
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i]!;
    if (!el.visible) continue;
    if (el.rect.width <= 0 || el.rect.height <= 0) continue;
    const text = (
      el.innerText + " " + (el.value || "") + " " + el.ariaLabel
    ).toLowerCase().trim();
    if (forbiddenTexts.some(f => text.includes(f))) continue;
    if (advanceTexts.some(a => text.includes(a))) return i;
  }
  return -1;
}
