// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The progress reactions a reviewer puts on a pull request's description
 * (GitHub reactions, GitLab award emoji), for the fake hosts in tests that are
 * about something else: they answer these with {@link reacted} without
 * recording them, so a test about the comment or the threads sees only the
 * calls it is about. `progress_test.ts` covers the reactions themselves.
 */
export const DESCRIPTION_REACTIONS =
  /\/issues\/\d+\/reactions|\/merge_requests\/\d+\/award_emoji/;

/** A reaction the host accepted. */
export const reacted = (): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
