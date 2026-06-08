/** Test doubles for the CLI's injectable seams. */

import type { SetupHost } from "../src/setup.ts";
import type { Prompter } from "../mod.ts";

/** An in-memory {@link SetupHost} that records writes, chmods, and logs. */
export class FakeHost implements SetupHost {
  /** Virtual filesystem: path → contents. */
  readonly files = new Map<string, string>();
  /** Lines passed to {@link log}. */
  readonly logs: string[] = [];
  /** `[path, mode]` pairs passed to {@link chmod}. */
  readonly chmods: Array<[string, number]> = [];
  /** When true, {@link chmod} rejects (simulating an unsupported platform). */
  chmodFails = false;

  constructor(initial?: Record<string, string>) {
    if (initial) {
      for (const [path, content] of Object.entries(initial)) {
        this.files.set(path, content);
      }
    }
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  readText(path: string): Promise<string> {
    const value = this.files.get(path);
    return value === undefined
      ? Promise.reject(new Error(`missing: ${path}`))
      : Promise.resolve(value);
  }

  writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }

  chmod(path: string, mode: number): Promise<void> {
    if (this.chmodFails) return Promise.reject(new Error("chmod unsupported"));
    this.chmods.push([path, mode]);
    return Promise.resolve();
  }

  log(message: string): void {
    this.logs.push(message);
  }
}

/** A scripted {@link Prompter} with canned answers. */
export class FakePrompter implements Prompter {
  constructor(
    private readonly tty: boolean,
    private readonly answer: string = "",
    private readonly yes: boolean = false,
  ) {}

  interactive(): boolean {
    return this.tty;
  }

  ask(_question: string, fallback: string): string {
    return this.answer === "" ? fallback : this.answer;
  }

  confirm(_question: string): boolean {
    return this.yes;
  }
}
