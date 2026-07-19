/**
 * The state-api wire-protocol version — the single contract shared by the HTTP
 * {@link "./http_store.ts".HttpStateStore} run/lock endpoints and the
 * {@link "../registry/http_registry.ts".HttpBuildRegistry} `/builds` endpoints
 * (one service hosts both — see `docs/state-api.md`).
 *
 * Each client stamps every request with `x-zuke-state-protocol: <version>` and,
 * on a response that declares a **different** version, fails loudly rather than
 * risk a silent mis-parse. A server that omits the header is treated as
 * compatible (legacy/tolerant), so the check only fires on a declared mismatch.
 *
 * @module
 */

/** The wire-contract version this client speaks (`docs/state-api.md`). */
export const STATE_PROTOCOL_VERSION = "1";

/** The request/response header carrying the {@link STATE_PROTOCOL_VERSION}. */
export const STATE_PROTOCOL_HEADER = "x-zuke-state-protocol";

/**
 * Throw a descriptive error when `response` declares a state-api protocol
 * version this client does not speak. A response with no version header passes
 * (a server that predates the header is assumed compatible). `context`
 * (`"state"` / `"registry"`) prefixes the message.
 */
export function assertProtocol(response: Response, context: string): void {
  const declared = response.headers.get(STATE_PROTOCOL_HEADER);
  if (declared !== null && declared !== STATE_PROTOCOL_VERSION) {
    throw new Error(
      `${context}: state-api protocol mismatch — the server declared ` +
        `"${declared}" but this client speaks "${STATE_PROTOCOL_VERSION}". ` +
        `Upgrade the client or the backend so both agree on the wire contract.`,
    );
  }
}
