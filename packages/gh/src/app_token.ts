/**
 * Mint a short-lived GitHub App installation token from a build, replacing the
 * `actions/create-github-app-token` step.
 *
 * A build that has to reach *another* repository cannot use the workflow's
 * `GITHUB_TOKEN` — that token is scoped to the repository running the workflow.
 * The way through is a GitHub App: sign a JWT with the app's private key, look
 * up the app's installation, and exchange the JWT for an installation token
 * narrowed to specific repositories and permissions. It expires in an hour.
 *
 * Doing it here rather than in a workflow step means the credential is minted by
 * the same target that uses it, so the build runs identically anywhere and the
 * workflow needs no step:
 *
 * ```ts
 * const { token } = await GhTasks.appToken((s) =>
 *   s.appId(appId).privateKey(pem)
 *     .owner("acme").repositories("acme.github.io")
 *     .permission("contents", "write")
 *     .permission("pull-requests", "write")
 * );
 * ```
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";

/** The GitHub REST base, overridable per call for GHES. */
const API_BASE = "https://api.github.com";

/** How long the signed app JWT is valid. GitHub rejects anything over 10 minutes. */
const JWT_TTL_SECONDS = 540;

/**
 * Clock-skew allowance on the JWT's `iat`: GitHub rejects a token issued in its
 * future, so back-date it slightly rather than fail on a fast runner clock.
 */
const JWT_SKEW_SECONDS = 60;

/** A permission level an installation token can be narrowed to. */
export type GhPermissionLevel = "read" | "write" | "admin";

/** A minted installation token and when it stops working. */
export interface GhAppTokenResult {
  /** The installation token, usable as a bearer token or a git password. */
  token: string;
  /** ISO-8601 expiry — one hour out, as GitHub issues it. */
  expiresAt: string;
  /** The installation the token was minted for. */
  installationId: number;
}

/** Base64url (no padding), as JWT requires. */
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

/** The DER length header for a payload of `length` bytes (short or long form). */
function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) {
    bytes.unshift(rest % 256);
  }
  return [0x80 | bytes.length, ...bytes];
}

/** The `AlgorithmIdentifier` for `rsaEncryption`, with its NULL parameters. */
const RSA_ALGORITHM_ID = [
  0x30,
  0x0d,
  0x06,
  0x09,
  0x2a,
  0x86,
  0x48,
  0x86,
  0xf7,
  0x0d,
  0x01,
  0x01,
  0x01,
  0x05,
  0x00,
];

/**
 * Wrap a PKCS#1 `RSAPrivateKey` in the PKCS#8 `PrivateKeyInfo` envelope
 * WebCrypto requires.
 *
 * GitHub hands out app keys in PKCS#1 (`BEGIN RSA PRIVATE KEY`), which
 * `crypto.subtle.importKey` cannot read — it accepts only PKCS#8
 * (`BEGIN PRIVATE KEY`). The envelope is a fixed prefix around the same key
 * material, so this is a re-frame, not a conversion.
 */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const key = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [0x02, 0x01, 0x00, ...RSA_ALGORITHM_ID, ...key];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

/** The DER bytes of a PEM block, whatever its label. */
function pemBody(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem
    .replace(/-----(BEGIN|END)[^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (base64 === "") {
    throw new Error(
      "the app private key is empty — pass the PEM contents, not a path.",
    );
  }
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    // A body that is not base64 at all — a PEM mangled by copy-paste, or a
    // secret that was truncated. Naming it beats surfacing a bare DOMException.
    throw new Error(
      "the app private key is not valid base64 — check the PEM was copied " +
        "whole, including both delimiter lines.",
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Import a PEM app key (PKCS#1 or PKCS#8) as an RS256 signing key. */
async function importSigningKey(pem: string): Promise<CryptoKey> {
  const der = pemBody(pem);
  const pkcs8 = /BEGIN RSA PRIVATE KEY/.test(pem) ? pkcs1ToPkcs8(der) : der;
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (error) {
    // A malformed key is the most common misconfiguration (a truncated secret,
    // a path instead of contents), so name it rather than surface a DataError.
    throw new Error(
      `the app private key could not be read as RSA PEM: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Settings for {@link GhAppTokenApi.appToken}. */
export class GhAppTokenSettings {
  /** The app's numeric id. Set by {@link appId}. */
  appId_?: string;
  /** The app's PEM private key. Set by {@link privateKey}. */
  privateKey_?: string;
  /** The account the app is installed on. Set by {@link owner}. */
  owner_?: string;
  /** Repositories to scope the token to. Set by {@link repositories}. */
  repositories_: string[] = [];
  /** Requested permissions. Set by {@link permission}. */
  permissions_: Record<string, GhPermissionLevel> = {};
  /** REST base URL. Set by {@link baseUrl}. */
  baseUrl_: string = API_BASE;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_: typeof fetch = fetch;
  /** Seconds since the epoch, for the JWT's claims. Set by {@link now}. */
  now_: () => number = () => Math.floor(Date.now() / 1000);

  /** The GitHub App's id (the `App ID` on its settings page). */
  appId(id: string | number): this {
    this.appId_ = String(id);
    return this;
  }

  /**
   * The app's private key, as the PEM's **contents** — GitHub issues PKCS#1
   * (`BEGIN RSA PRIVATE KEY`); PKCS#8 is accepted too.
   */
  privateKey(pem: string): this {
    this.privateKey_ = pem;
    return this;
  }

  /** The user or organisation the app is installed on. */
  owner(login: string): this {
    this.owner_ = login;
    return this;
  }

  /**
   * Scope the token to these repositories (names only, without the owner).
   * Omit to cover every repository the installation can reach — prefer naming
   * them, so a leaked token is narrow.
   */
  repositories(...names: string[]): this {
    this.repositories_.push(...names);
    return this;
  }

  /**
   * Request one permission, e.g. `.permission("contents", "write")`. Repeatable.
   * Narrowing to what the target needs beats inheriting the app's full set;
   * requesting more than the installation grants is an error from GitHub.
   *
   * The API names multi-word permissions with underscores (`pull_requests`), so
   * a hyphen is normalised to one. That spelling is the trap here:
   * `create-github-app-token` takes its inputs as `permission-pull-requests`,
   * and passing that form straight through is rejected as a permission the
   * installation does not grant — which reads as a misconfigured app rather
   * than a misspelled key.
   */
  permission(name: string, level: GhPermissionLevel): this {
    this.permissions_[name.replace(/-/g, "_")] = level;
    return this;
  }

  /** Use a different REST base (GitHub Enterprise Server). */
  baseUrl(url: string): this {
    this.baseUrl_ = url.replace(/\/+$/, "");
    return this;
  }

  /** Override the `fetch` implementation (a test seam). */
  fetch(fn: typeof fetch): this {
    this.fetch_ = fn;
    return this;
  }

  /** Override the clock, in seconds since the epoch (a test seam). */
  now(seconds: () => number): this {
    this.now_ = seconds;
    return this;
  }

  /** Sign the app JWT this settings object describes. */
  async jwt_(): Promise<string> {
    if (this.appId_ === undefined || this.appId_ === "") {
      throw new Error("minting an app token requires .appId(...).");
    }
    if (this.privateKey_ === undefined || this.privateKey_ === "") {
      throw new Error("minting an app token requires .privateKey(...).");
    }
    const issued = this.now_() - JWT_SKEW_SECONDS;
    const encoder = new TextEncoder();
    const header = base64Url(
      encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    );
    const claims = base64Url(
      encoder.encode(
        JSON.stringify({
          iat: issued,
          exp: issued + JWT_TTL_SECONDS,
          iss: this.appId_,
        }),
      ),
    );
    const key = await importSigningKey(this.privateKey_);
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      encoder.encode(`${header}.${claims}`),
    );
    return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
  }

  /** The path that resolves this app's installation id. */
  installationPath_(): string {
    if (this.owner_ === undefined || this.owner_ === "") {
      throw new Error("minting an app token requires .owner(...).");
    }
    // With a repository named, ask about that repository: it works for a
    // user-owned and an org-owned installation alike. Otherwise fall back to
    // the org-level lookup.
    const repo = this.repositories_[0];
    return repo === undefined
      ? `/orgs/${this.owner_}/installation`
      : `/repos/${this.owner_}/${repo}/installation`;
  }

  /** The `access_tokens` request body — only the fields that were narrowed. */
  tokenRequest_(): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (this.repositories_.length > 0) {
      body.repositories = this.repositories_;
    }
    if (Object.keys(this.permissions_).length > 0) {
      body.permissions = this.permissions_;
    }
    return body;
  }
}

/** The headers every app-authenticated request carries. */
function appHeaders(jwt: string): Record<string, string> {
  return {
    "accept": "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "authorization": `Bearer ${jwt}`,
  };
}

/** Read a JSON body, throwing a message that names the endpoint and status. */
async function json(
  response: Response,
  what: string,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${what} failed: ${response.status} ${response.statusText}. ` +
        `${text.slice(0, 400)}`,
    );
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("not an object");
    }
    return { ...parsed };
  } catch {
    throw new Error(
      `${what} returned a body that is not JSON: ${text.slice(0, 200)}`,
    );
  }
}

/**
 * Ask the Actions runner to mask `value` in its logs, matching what
 * `actions/create-github-app-token` does with the token it outputs. Outside
 * Actions this is a no-op, so a local run prints nothing odd.
 */
function maskInActions(value: string): void {
  let inActions = false;
  try {
    inActions = Deno.env.get("GITHUB_ACTIONS") === "true";
  } catch {
    return; // no env permission: nothing to mask into
  }
  if (inActions) console.log(`::add-mask::${value}`);
}

/** The shape of the app-token task, mixed into `GhTasks`. */
export interface GhAppTokenApi {
  /**
   * Mint a GitHub App installation token, scoped to the repositories and
   * permissions the settings request. The returned token is registered with the
   * Actions log masker, so it is safe to pass onward through `env`.
   */
  appToken(
    configure?: Configure<GhAppTokenSettings>,
  ): Promise<GhAppTokenResult>;
}

/** Mint an installation token from the settings a lambda configures. */
export async function mintAppToken(
  configure?: Configure<GhAppTokenSettings>,
): Promise<GhAppTokenResult> {
  const settings = configure
    ? configure(new GhAppTokenSettings())
    : new GhAppTokenSettings();
  const jwt = await settings.jwt_();
  const request = settings.fetch_;

  const installation = await json(
    await request(`${settings.baseUrl_}${settings.installationPath_()}`, {
      headers: appHeaders(jwt),
    }),
    "resolving the app installation",
  );
  const installationId = installation.id;
  if (typeof installationId !== "number") {
    throw new Error(
      "the installation lookup returned no numeric id — is the app installed " +
        `on ${settings.owner_}?`,
    );
  }

  const minted = await json(
    await request(
      `${settings.baseUrl_}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: { ...appHeaders(jwt), "content-type": "application/json" },
        body: JSON.stringify(settings.tokenRequest_()),
      },
    ),
    "minting the installation token",
  );
  const token = minted.token;
  const expiresAt = minted.expires_at;
  if (typeof token !== "string" || typeof expiresAt !== "string") {
    throw new Error("the mint response carried no token.");
  }
  maskInActions(token);
  return { token, expiresAt, installationId };
}
