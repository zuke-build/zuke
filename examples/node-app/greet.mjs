// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Greet `name`, or the world when the name is blank. */
export function greet(name = "") {
  const who = name.trim() === "" ? "world" : name.trim();
  return `Hello, ${who}!`;
}
