// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The script `npmVerify` runs under node, in the toolchain directory where
 * sigstore-js is installed (`build/npm_toolchain`). It is a string because it
 * is node's code, not Deno's: Deno would try to resolve its `sigstore` import
 * when type-checking a file of its own.
 */

/** `verify_bundle.mjs`: verify one Sigstore bundle against a policy. */
export const VERIFY_BUNDLE_SCRIPT = `// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

// Verifies one Sigstore bundle under node, with sigstore-js, against a policy:
//   node verify_bundle.mjs <bundle.json> <policy.json> <tuf-cache-dir> <root>
// <root> is "refresh", to fetch Sigstore's trusted root over TUF, or "bundled",
// to use the copy sigstore-js ships and touch no network.
// The policy is {certificateIssuer, certificateIdentityURI, certificateOIDs}
// as sigstore-js's \`verify\` takes them. Exits 0 when the bundle's signature,
// certificate chain and transparency-log entry check out and the certificate
// satisfies the policy; otherwise prints why to stderr and exits 1.

import { readFileSync } from "node:fs";
import { verify } from "sigstore";

const [bundleFile, policyFile, tufCachePath, root] = process.argv.slice(2);
try {
  const bundle = JSON.parse(readFileSync(bundleFile, "utf8"));
  const policy = JSON.parse(readFileSync(policyFile, "utf8"));
  await verify(bundle, {
    ...policy,
    tufCachePath,
    tufForceCache: root === "bundled",
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;
