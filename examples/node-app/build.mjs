// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

// The app's own build step: stand-in for a bundler. Zuke does not replace
// your Node tooling — it drives it, through `npm run build`.
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await copyFile("greet.mjs", "dist/greet.mjs");
console.log("built dist/greet.mjs");
