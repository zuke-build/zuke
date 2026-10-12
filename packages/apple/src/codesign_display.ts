// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The result of `codesign --display`, parsed.
 *
 * `codesign` writes the description to **stderr**, one `Key=Value` per line —
 * `Identifier=com.example.app`, `TeamIdentifier=ABCDE12345`, and one
 * `Authority=` line per certificate in the chain, leaf first. A wrapper that
 * returned only stdout would hand back an empty string, so the description is
 * read from both streams.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";

/** A code signature as `codesign --display` describes it. */
export interface CodesignDisplay {
  /** The signed code's identifier (`Identifier=`), when printed. */
  identifier?: string;
  /**
   * The team identifier (`TeamIdentifier=`), when printed. `codesign` prints
   * `not set` for an ad-hoc signature, and that text is kept as it is.
   */
  teamIdentifier?: string;
  /** The certificate chain (`Authority=` lines), leaf first. */
  authorities: string[];
  /** The whole description: stderr, then any stdout, trimmed. */
  text: string;
  /** The command output the description was read from. */
  output: CommandOutput;
}

/** Parse a `codesign --display` run's output into a {@link CodesignDisplay}. */
export function parseCodesignDisplay(output: CommandOutput): CodesignDisplay {
  const text = [output.stderr.trim(), output.stdout.trim()]
    .filter((part) => part !== "")
    .join("\n");
  const display: CodesignDisplay = { authorities: [], text, output };
  for (const line of text.split(/\r?\n/)) {
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals);
    const value = line.slice(equals + 1).trim();
    if (key === "Identifier") display.identifier = value;
    else if (key === "TeamIdentifier") display.teamIdentifier = value;
    else if (key === "Authority") display.authorities.push(value);
  }
  return display;
}
