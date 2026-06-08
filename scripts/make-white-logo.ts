/**
 * One-off asset script: derive a dark-mode ("white") variant of the logo.
 *
 * The brand logo (`assets/logo.png`) is a dark-navy ninja-raccoon with green
 * terminal and teal "zuke" gradient accents. On a dark background the navy
 * disappears, so this recolors only the dark-navy pixels to white while
 * preserving the green and teal accents (and the per-pixel alpha, so the
 * anti-aliased edges stay smooth).
 *
 * Run: `deno run --allow-read --allow-write scripts/make-white-logo.ts`
 */
import { decodePNG, encodePNG } from "jsr:@img/png@^0.1";

const SRC = new URL("../assets/logo.png", import.meta.url);
const OUT = new URL("../assets/logo-white.png", import.meta.url);

const { header, body } = await decodePNG(await Deno.readFile(SRC));

for (let i = 0; i < body.length; i += 4) {
  const r = body[i], g = body[i + 1], b = body[i + 2], a = body[i + 3];
  if (a === 0) continue; // fully transparent — leave it

  const maxChannel = Math.max(r, g, b);

  // Keep the green terminal (green channel dominant).
  if (g > r * 1.15 && g > b * 1.15) continue;
  // Keep the teal / blue "zuke" gradient (bright, blue-dominant).
  if (b >= 90 && b >= g) continue;

  // Everything dark (the navy raccoon, wrench, "</>" marks) → white,
  // keeping the original alpha so edges stay anti-aliased.
  if (maxChannel < 80) {
    body[i] = 255;
    body[i + 1] = 255;
    body[i + 2] = 255;
  }
}

const out = await encodePNG(body, {
  width: header.width,
  height: header.height,
  compression: 0,
  filter: 0,
  interlace: 0,
});
await Deno.writeFile(OUT, out);
console.log(`wrote ${OUT.pathname} (${header.width}x${header.height})`);
