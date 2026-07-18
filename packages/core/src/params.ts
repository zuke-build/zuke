/**
 * Build parameters: typed, injectable inputs resolved from CLI flags and
 * environment variables before targets run.
 *
 * Parameters are declared as class fields, exactly like targets — the framework
 * discovers them by introspection (see {@link discoverParameters}) and resolves
 * each value before the build executes. Declaration is fully type-safe: the
 * fluent builder narrows the value type as you configure it, so a target reads
 * a resolved value off `this`.
 *
 * ```ts
 * import { Build, parameter, target } from "jsr:@zuke/core";
 *
 * class Deploy extends Build {
 *   environment = parameter("Target environment")
 *     .options("dev", "staging", "production")
 *     .required();
 *
 *   deploy = target().executes(() => {
 *     console.log(`Deploying to ${this.environment.value}`); // string
 *   });
 * }
 * ```
 *
 * A value comes from `--environment <v>` (or `--environment=<v>`), else the
 * `ENVIRONMENT` environment variable, else the declared default; the CLI wins
 * over the environment, which wins over the default.
 *
 * @module
 */

import { forEachField } from "./build.ts";
import type { Redactor } from "./redact.ts";
import type { SecretSource } from "./secret.ts";

/** The value kinds a parameter can hold. */
export type ParamValue = string | number | boolean;

/** A parameter's runtime kind tag. */
export type ParamKind = "string" | "number" | "boolean";

/** Internal resolved state: a value is present only once `ok` is true. */
type Resolved<T> = { readonly ok: true; readonly value: T } | {
  readonly ok: false;
};

/** Internal fallback (declared default): present only when `has` is true. */
type Fallback<T> = { readonly has: true; readonly value: T } | {
  readonly has: false;
};

/** Raised when a parameter value is invalid or read before resolution. */
export class ParameterError extends Error {
  /** The error name. */
  override name = "ParameterError";
}

/** Parse a raw string as a finite number, or throw {@link ParameterError}. */
function parseNumber(raw: string): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value)) {
    throw new ParameterError(`expected a number, got "${raw}"`);
  }
  return value;
}

/** Parse a raw string as a boolean, or throw {@link ParameterError}. */
function parseBoolean(raw: string): boolean {
  const value = raw.toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  throw new ParameterError(`expected a boolean, got "${raw}"`);
}

/** Build a string parser that optionally enforces a fixed set of choices. */
function makeStringParser(
  options?: readonly string[],
): (raw: string) => string {
  return (raw: string): string => {
    if (options !== undefined && !options.includes(raw)) {
      throw new ParameterError(
        `expected one of ${options.join(", ")}, got "${raw}"`,
      );
    }
    return raw;
  };
}

/** The non-generic view of a parameter, used by discovery and resolution. */
export interface AnyParameter {
  /** Property name, assigned during discovery. Undefined until then. */
  name_?: string;
  /** Human-readable description shown in `--help`/`--list`. */
  readonly description_?: string;
  /** The runtime value kind. */
  readonly kind_: ParamKind;
  /** Whether a value must be supplied (no default). */
  readonly required_: boolean;
  /** The allowed string choices, if restricted with {@link Parameter.options}. */
  readonly options_?: readonly string[];
  /** An explicit environment variable name override. */
  readonly envName_?: string;
  /** Whether the parameter has a declared default value. */
  readonly hasFallback_: boolean;
  /** Whether the value is sensitive and should be masked in CI output. */
  readonly secret_: boolean;
  /** Whether the value is a comma-separated / repeatable list (`.array()`). */
  readonly array_: boolean;
  /** A provider that resolves the value when no flag/env supplied one. */
  readonly source_?: SecretSource;
  /** Resolve from a raw input (or `undefined` when none was supplied). */
  resolve_(raw: string | undefined): void;
  /** Whether the parameter resolved to a defined value (used by `.requires()`). */
  isSet_(): boolean;
  /** The resolved value as a string, or `undefined` if unset (for masking). */
  stringValue_(): string | undefined;
}

/** The constructor spec for a {@link Parameter}. */
interface ParamSpec<K extends ParamValue, T extends K | K[] | undefined> {
  description?: string;
  kind: ParamKind;
  required: boolean;
  options?: readonly string[];
  envName?: string;
  parse: (raw: string) => T;
  fallback: Fallback<T>;
  secret?: boolean;
  array?: boolean;
  source?: SecretSource;
}

/**
 * A typed build parameter. Declare one with {@link parameter} and configure it
 * with the fluent methods; each method returns a new parameter whose `value`
 * type reflects the configuration (`string`, `number`, `boolean`, and whether
 * it can be `undefined`).
 *
 * `K` is the underlying value kind; `T` is the exposed `value` type, which is
 * `K` for required/defaulted parameters and `K | undefined` for optional ones.
 */
export class Parameter<
  K extends ParamValue = ParamValue,
  T extends K | K[] | undefined = K | undefined,
> implements AnyParameter {
  /** Property name, assigned during discovery. Undefined until then. */
  name_?: string;
  /** Human-readable description shown in `--help`/`--list`. */
  readonly description_?: string;
  /** The runtime value kind. */
  readonly kind_: ParamKind;
  /** Whether a value must be supplied (no default). */
  readonly required_: boolean;
  /** The allowed string choices, if restricted with {@link Parameter.options}. */
  readonly options_?: readonly string[];
  /** An explicit environment variable name override. */
  readonly envName_?: string;
  /** Whether the parameter has a declared default value. */
  readonly hasFallback_: boolean;
  /** Whether the value is sensitive and should be masked in CI output. */
  readonly secret_: boolean;
  /** Whether the value is a comma-separated / repeatable list (`.array()`). */
  readonly array_: boolean;
  /** A provider that resolves the value when no flag/env supplied one. */
  readonly source_?: SecretSource;
  readonly #parse: (raw: string) => T;
  readonly #fallback: Fallback<T>;
  #state: Resolved<T> = { ok: false };

  /**
   * Wrap this parameter's parser to return a definitely-present value. The
   * parsers never yield `undefined` (they return a value or throw), so the
   * guard only narrows the type — it lets `.default()`/`.required()` produce a
   * `(raw) => K` parser from this `(raw) => T` one without a cast.
   */
  #definiteParse(this: Parameter<K, K | undefined>): (raw: string) => K {
    const parse = this.#parse;
    return (raw: string): K => {
      const value = parse(raw);
      if (value === undefined) {
        throw new ParameterError("internal: parser produced no value");
      }
      return value;
    };
  }

  /** Build a parameter from its resolved constructor spec. */
  constructor(spec: ParamSpec<K, T>) {
    this.description_ = spec.description;
    this.kind_ = spec.kind;
    this.required_ = spec.required;
    this.options_ = spec.options;
    this.envName_ = spec.envName;
    this.#parse = spec.parse;
    this.#fallback = spec.fallback;
    this.hasFallback_ = spec.fallback.has;
    this.secret_ = spec.secret ?? false;
    this.array_ = spec.array ?? false;
    this.source_ = spec.source;
  }

  /** The resolved value. Throws if read before the build resolves parameters. */
  get value(): T {
    if (!this.#state.ok) {
      throw new ParameterError(
        `Parameter "${this.name_ ?? "(unnamed)"}" was read before it was ` +
          `resolved. Read parameters inside a target body, not at construction.`,
      );
    }
    return this.#state.value;
  }

  /** Whether the parameter resolved to a defined value (used by `.requires()`). */
  isSet_(): boolean {
    return this.#state.ok && this.#state.value !== undefined;
  }

  /** The resolved value as a string, or `undefined` if unset (for masking). */
  stringValue_(): string | undefined {
    return this.#state.ok && this.#state.value !== undefined
      ? String(this.#state.value)
      : undefined;
  }

  /**
   * Mark the value as sensitive: it is masked in CI output (`::add-mask::`) and
   * redacted from all of Zuke's reporter output. Pair with {@link Parameter.from}
   * to resolve the value from a secret manager rather than the environment.
   */
  secret(): Parameter<K, T> {
    return new Parameter<K, T>({
      description: this.description_,
      kind: this.kind_,
      required: this.required_,
      options: this.options_,
      envName: this.envName_,
      parse: this.#parse,
      fallback: this.#fallback,
      secret: true,
      array: this.array_,
      source: this.source_,
    });
  }

  /**
   * Resolve the value from a {@link SecretSource} (see {@link execSecret} /
   * {@link fileSecret}) when neither a `--flag` nor an environment variable
   * supplied one — the source is a fallback provider, consulted before the
   * declared default. Typically paired with {@link Parameter.secret} so the
   * resolved value is redacted.
   */
  from(source: SecretSource): Parameter<K, T> {
    return new Parameter<K, T>({
      description: this.description_,
      kind: this.kind_,
      required: this.required_,
      options: this.options_,
      envName: this.envName_,
      parse: this.#parse,
      fallback: this.#fallback,
      secret: this.secret_,
      array: this.array_,
      source,
    });
  }

  /** Parse the value as a number (e.g. `--workers 4`). */
  number(
    this: Parameter<string, string | undefined>,
  ): Parameter<number, number | undefined> {
    return new Parameter<number, number | undefined>({
      description: this.description_,
      kind: "number",
      required: false,
      envName: this.envName_,
      parse: parseNumber,
      fallback: { has: true, value: undefined },
      secret: this.secret_,
      source: this.source_,
    });
  }

  /** Treat the parameter as a boolean flag (e.g. `--verbose`); defaults to false. */
  boolean(
    this: Parameter<string, string | undefined>,
  ): Parameter<boolean, boolean> {
    return new Parameter<boolean, boolean>({
      description: this.description_,
      kind: "boolean",
      required: false,
      envName: this.envName_,
      parse: parseBoolean,
      fallback: { has: true, value: false },
      secret: this.secret_,
      source: this.source_,
    });
  }

  /** Restrict a string parameter to a fixed set of choices. */
  options(
    this: Parameter<string, string | undefined>,
    ...values: string[]
  ): Parameter<string, string | undefined> {
    return new Parameter<string, string | undefined>({
      description: this.description_,
      kind: "string",
      required: this.required_,
      options: values,
      envName: this.envName_,
      parse: makeStringParser(values),
      fallback: this.#fallback,
      secret: this.secret_,
      source: this.source_,
    });
  }

  /** Provide a default, making `value` non-optional (`K`). */
  default(this: Parameter<K, K | undefined>, value: K): Parameter<K, K> {
    return new Parameter<K, K>({
      description: this.description_,
      kind: this.kind_,
      required: false,
      options: this.options_,
      envName: this.envName_,
      parse: this.#definiteParse(),
      fallback: { has: true, value },
      secret: this.secret_,
      source: this.source_,
    });
  }

  /** Require a value, making `value` non-optional (`K`); errors if unsupplied. */
  required(this: Parameter<K, K | undefined>): Parameter<K, K> {
    return new Parameter<K, K>({
      description: this.description_,
      kind: this.kind_,
      required: true,
      options: this.options_,
      envName: this.envName_,
      parse: this.#definiteParse(),
      fallback: { has: false },
      secret: this.secret_,
      source: this.source_,
    });
  }

  /** Override the environment variable read as a fallback for this parameter. */
  env(name: string): Parameter<K, T> {
    return new Parameter<K, T>({
      description: this.description_,
      kind: this.kind_,
      required: this.required_,
      options: this.options_,
      envName: name,
      parse: this.#parse,
      fallback: this.#fallback,
      secret: this.secret_,
      array: this.array_,
      source: this.source_,
    });
  }

  /**
   * Accept a comma-separated list (or a repeated flag), exposing `value` as an
   * array. `--tags a,b` and `--tags a --tags b` both yield `["a", "b"]`; blank
   * entries are dropped, and an unsupplied list defaults to `[]`.
   *
   * Each element is parsed by this parameter's own element parser, so it
   * composes: `.options("a", "b").array()` validates **every** element against
   * the choices, and `.number().array()` yields a `number[]`, rejecting a
   * non-numeric entry. (Apply `.options()`/`.number()` before `.array()`.)
   */
  array<E extends string | number>(
    this: Parameter<E, E | undefined>,
  ): Parameter<E, E[]> {
    // Reuse this parameter's scalar parser on each entry, so number parsing and
    // option validation apply per element rather than to the raw list string.
    const element = this.#parse;
    return new Parameter<E, E[]>({
      description: this.description_,
      kind: this.kind_,
      required: false,
      options: this.options_,
      envName: this.envName_,
      parse: (raw) =>
        raw.split(",").map((s) => s.trim()).filter((s) => s !== "").map(
          (entry) => {
            const value = element(entry);
            if (value === undefined) {
              throw new ParameterError("internal: parser produced no value");
            }
            return value;
          },
        ),
      fallback: { has: true, value: [] },
      secret: this.secret_,
      array: true,
      source: this.source_,
    });
  }

  /** Resolve from a raw input (or `undefined` when none was supplied). */
  resolve_(raw: string | undefined): void {
    if (raw !== undefined) {
      this.#state = { ok: true, value: this.#parse(raw) };
      return;
    }
    if (this.#fallback.has) {
      this.#state = { ok: true, value: this.#fallback.value };
    }
    // Otherwise leave unresolved; resolveParameters reports a missing required.
  }
}

/**
 * Create a new build parameter (a `string` by default). Configure it fluently:
 * `.number()`/`.boolean()` change the kind, `.options(...)` restricts a string,
 * `.default(v)`/`.required()` set optionality, and `.env(name)` overrides the
 * environment variable.
 */
export function parameter(
  description?: string,
): Parameter<string, string | undefined> {
  return new Parameter<string, string | undefined>({
    description,
    kind: "string",
    required: false,
    parse: makeStringParser(),
    fallback: { has: true, value: undefined },
  });
}

/**
 * Discover all parameters declared on a build instance: scan its fields
 * (recursing into plain-object component bundles) for {@link Parameter} values,
 * bind each its dotted property path, and return a name → parameter map
 * preserving declaration order.
 */
export function discoverParameters(build: object): Map<string, AnyParameter> {
  const params = new Map<string, AnyParameter>();
  forEachField(build, (path, value) => {
    if (value instanceof Parameter) {
      value.name_ = path;
      params.set(path, value);
    }
  });
  return params;
}

/** The CLI flag for a parameter: its property path in kebab-case. */
export function flagName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/\./g, "-")
    .toLowerCase();
}

/** The environment variable for a parameter: its path in SCREAMING_SNAKE_CASE. */
export function envVarName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/\./g, "_")
    .toUpperCase();
}

/**
 * Resolve every parameter from CLI values (keyed by property name) and the
 * environment, applying defaults. Returns a list of human-readable errors for
 * missing-required or invalid values; empty means success.
 *
 * Resolution precedence is CLI value, then environment variable, then a
 * declared {@link Parameter.from} secret source, then the declared default. A
 * secret parameter's raw value is registered with the optional {@link Redactor}
 * as soon as it is obtained — before parsing — so even a parse error cannot
 * echo it.
 *
 * @param params Discovered parameters.
 * @param cliValues Raw values parsed from the command line, keyed by name.
 * @param readEnv Reads an environment variable by name.
 * @param prompt Optional: ask for a missing required value (interactive input).
 * @param redactor Optional: collects secret raw values for output masking.
 */
export async function resolveParameters(
  params: Map<string, AnyParameter>,
  cliValues: Record<string, string>,
  readEnv: (name: string) => string | undefined,
  prompt?: (
    flag: string,
    description: string | undefined,
  ) => string | undefined,
  redactor?: Redactor,
): Promise<string[]> {
  const errors: string[] = [];
  for (const [name, param] of params) {
    const envName = param.envName_ ?? envVarName(name);
    let raw = name in cliValues ? cliValues[name] : readEnv(envName);
    // Prompt for a missing required value when an input source is available.
    if (raw === undefined && param.required_ && !param.hasFallback_ && prompt) {
      const answer = prompt(flagName(name), param.description_);
      if (answer !== undefined && answer !== "") raw = answer;
    }
    // Fall back to a secret source when nothing else supplied a value.
    if (raw === undefined && param.source_ !== undefined) {
      try {
        raw = await param.source_.resolve();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`--${flagName(name)}: ${message}`);
        continue;
      }
    }
    // Register a secret's raw value for redaction before it is parsed, so a
    // parse error below is masked too.
    if (redactor && param.secret_ && raw !== undefined && raw !== "") {
      redactor.add(raw);
    }
    try {
      param.resolve_(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`--${flagName(name)}: ${message}`);
      continue;
    }
    if (raw === undefined && param.required_ && !param.hasFallback_) {
      errors.push(`--${flagName(name)} is required (or set ${envName}).`);
    }
  }
  return errors;
}
