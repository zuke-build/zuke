/**
 * Fence untrusted content (an attacker-controlled diff, a failing command's
 * output) between markers the system prompt treats as data-only.
 *
 * @module
 */

/**
 * Wrap `content` between `<<<LABEL` and `LABEL>>>` markers, first neutralizing
 * any occurrence of those markers the content itself contains — so a payload
 * that embeds the closing marker cannot terminate the block early and smuggle
 * instructions into the trusted context around it.
 *
 * This is defense-in-depth alongside the system-prompt clause, not a hard
 * structural guarantee (an LLM can still be coaxed); it removes the one
 * deterministic breakout — forging the exact delimiter.
 */
export function fenceUntrusted(label: string, content: string): string {
  const open = `<<<${label}`;
  const close = `${label}>>>`;
  const safe = content
    .replaceAll(close, `${label}_>>>`)
    .replaceAll(open, `<<<${label}_`);
  return `${open}\n${safe}\n${close}`;
}
