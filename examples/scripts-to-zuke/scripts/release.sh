#!/usr/bin/env bash
# Copyright (c) 2026 the Zuke contributors
# SPDX-License-Identifier: MIT
#
# The script every small project has: it started as three lines, grew a flag
# and two guards, and now nobody wants to touch it. See release.ts for the
# same thing in TypeScript, and ../zuke.ts for it as targets.
set -euo pipefail

VERSION="${1:-}"
DRY_RUN="${2:-}"
if [ -z "$VERSION" ]; then
  echo "usage: scripts/release.sh <version> [--dry-run]" >&2
  exit 2
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "release: the working tree is not clean" >&2
  exit 1
fi

deno test -A

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "dry run: would tag v$VERSION and push"
  exit 0
fi

git tag -a "v$VERSION" -m "Release $VERSION"
git push origin --follow-tags
