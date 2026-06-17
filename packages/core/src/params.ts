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

/** The value kinds a parameter can hold. */
export type ParamValue = string | number | boolean;

/** A parameter's runtime kind tag. */
type ParamKind = "string" | "number" | "boolean";

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
  /** Resolve from a raw input (or `undefined` when none was supplied). */
  resolve_(raw: string | undefined): void;
  /** Whether the parameter resolved to a defined value (used by `.requires()`). */
  isSet_(): boolean;
  /** The resolved value as a string, or `undefined` if unset (for masking). */
  stringValue_(): string | undefined;
}

/** The constructor spec for a {@link Parameter}. */
interface ParamSpec<K extends ParamValue, T extends K | undefined> {
  description?: string;
  kind: ParamKind;
  required: boolean;
  options?: readonly string[];
  envName?: string;
  parse: (raw: string) => T;
  fallback: Fallback<T>;
  secret?: boolean;
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
  T extends K | undefined = K | undefined,
> implements AnyParameter {
  name_?: string;
  readonly description_?: string;
  readonly kind_: ParamKind;
  readonly required_: boolean;
  readonly options_?: readonly string[];
  readonly envName_?: string;
  readonly hasFallback_: boolean;
  readonly secret_: boolean;
  readonly #parse: (raw: string) => T;
  readonly #fallback: Fallback<T>;
  #state: Resolved<T> = { ok: false };

  /**
   * Wrap this parameter's parser to return a definitely-present value. The
   * parsers never yield `undefined` (they return a value or throw), so the
   * guard only narrows the type — it lets `.default()`/`.required()` produce a
   * `(raw) => K` parser from this `(raw) => T` one without a cast.
   */
  #definiteParse(): (raw: string) => K {
    const parse = this.#parse;
    return (raw: string): K => {
      const value = parse(raw);
      if (value === undefined) {
        throw new ParameterError("internal: parser produced no value");
      }
      return value;
    };
  }

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

  isSet_(): boolean {
    return this.#state.ok && this.#state.value !== undefined;
  }

  stringValue_(): string | undefined {
    return this.#state.ok && this.#state.value !== undefined
      ? String(this.#state.value)
      : undefined;
  }

  /** Mark the value as sensitive, so it is masked in CI output (`::add-mask::`). */
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
    });
  }

  /** Provide a default, making `value` non-optional (`K`). */
  default(value: K): Parameter<K, K> {
    return new Parameter<K, K>({
      description: this.description_,
      kind: this.kind_,
      required: false,
      options: this.options_,
      envName: this.envName_,
      parse: this.#definiteParse(),
      fallback: { has: true, value },
      secret: this.secret_,
    });
  }

  /** Require a value, making `value` non-optional (`K`); errors if unsupplied. */
  required(): Parameter<K, K> {
    return new Parameter<K, K>({
      description: this.description_,
      kind: this.kind_,
      required: true,
      options: this.options_,
      envName: this.envName_,
      parse: this.#definiteParse(),
      fallback: { has: false },
      secret: this.secret_,
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
    });
  }

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
 * @param params Discovered parameters.
 * @param cliValues Raw values parsed from the command line, keyed by name.
 * @param readEnv Reads an environment variable by name.
 * @param prompt Optional: ask for a missing required value (interactive input).
 */
export function resolveParameters(
  params: Map<string, AnyParameter>,
  cliValues: Record<string, string>,
  readEnv: (name: string) => string | undefined,
  prompt?: (
    flag: string,
    description: string | undefined,
  ) => string | undefined,
): string[] {
  const errors: string[] = [];
  for (const [name, param] of params) {
    const envName = param.envName_ ?? envVarName(name);
    let raw = name in cliValues ? cliValues[name] : readEnv(envName);
    // Prompt for a missing required value when an input source is available.
    if (raw === undefined && param.required_ && !param.hasFallback_ && prompt) {
      const answer = prompt(flagName(name), param.description_);
      if (answer !== undefined && answer !== "") raw = answer;
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
