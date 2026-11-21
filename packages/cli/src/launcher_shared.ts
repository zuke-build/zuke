// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The pieces the bootstrapping launchers share: the license header, and the
 * download-with-retry and SHA-256 verification of a pinned archive. One
 * implementation, so the Deno and Node launchers cannot drift on how a
 * download is retried or verified.
 *
 * @module
 */

/** The MIT notice every generated launcher opens with (after its shebang). */
export const LICENSE_HEADER = `# Copyright (c) 2026 the Zuke contributors
# SPDX-License-Identifier: MIT`;

/* cspell:disable */

/**
 * The bash steps that fetch `$download_url` into `$archive` (inside a fresh
 * `$work_dir`, removed on exit) with retries, then check its SHA-256 against
 * `$expected_sha256`, exiting 1 on a mismatch. Expects `asset`,
 * `download_url` and `expected_sha256` to be set, and is indented for use
 * inside an `if` block. `name` is the tool, for messages.
 */
export function bashFetchVerified(name: string): string {
  return `  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' EXIT
  archive="$work_dir/$asset"

  # The download fetches over the network, which is occasionally flaky (e.g. a
  # transient 5xx from the CDN). Retry a few times with backoff so a blip
  # doesn't fail the whole run.
  download_${name.toLowerCase()}() {
    curl -fsSL -o "$archive" "$download_url"
  }
  attempt=1
  max_attempts=4
  until download_${name.toLowerCase()}; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "zuke: failed to download ${name} after $max_attempts attempts." >&2
      exit 1
    fi
    delay=$((attempt * 3))
    echo "zuke: ${name} download failed (attempt $attempt/$max_attempts); retrying in \${delay}s..." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done

  if command -v sha256sum >/dev/null 2>&1; then
    actual_sha256="$(sha256sum "$archive" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual_sha256="$(shasum -a 256 "$archive" | awk '{print $1}')"
  else
    echo "zuke: neither sha256sum nor shasum is available to verify the download." >&2
    exit 1
  fi
  if [ "$actual_sha256" != "$expected_sha256" ]; then
    echo "zuke: checksum mismatch for $asset:" >&2
    echo "      expected $expected_sha256" >&2
    echo "      got      $actual_sha256" >&2
    exit 1
  fi`;
}

/**
 * The PowerShell steps that fetch `$downloadUrl` into `$archive` with
 * retries, then check its SHA-256 against `$expectedSha256`, throwing on a
 * mismatch. Indented for use inside a `try` block; `name` is the tool, for
 * messages.
 */
export function pwshFetchVerified(name: string): string {
  return `    # The download fetches over the network, which is occasionally flaky (e.g.
    # a transient 5xx from the CDN). Retry a few times with backoff so a blip
    # doesn't fail the whole run.
    $maxAttempts = 4
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
      try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $archive
        break
      } catch {
        if ($attempt -ge $maxAttempts) {
          throw "zuke: failed to download ${name} after $maxAttempts attempts: $_"
        }
        $delay = $attempt * 3
        Write-Host "zuke: ${name} download failed (attempt $attempt/$maxAttempts); retrying in \${delay}s..."
        Start-Sleep -Seconds $delay
      }
    }

    $actualSha256 = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $expectedSha256.ToLowerInvariant()) {
      throw "zuke: checksum mismatch for \${asset}: expected $expectedSha256, got $actualSha256"
    }`;
}

/* cspell:enable */
