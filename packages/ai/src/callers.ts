// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Who may start a review with a comment command — decided in-process, by the
 * default branch's own build, before anything is spent.
 *
 * The generated command job runs for anyone who can comment, and passes the
 * commenter's login, the least role the command admits and the logins it
 * admits whatever their role, as env. The reviewer asks GitHub's
 * collaborators API what the commenter may do, through `GhTasks`, and starts
 * only for a role at or above the minimum or a login the command names.
 *
 * The event's `author_association` is deliberately not consulted: it reports an
 * organisation member whose membership is private as `CONTRIBUTOR` (observed
 * on this repository's own pull requests, where it turned the maintainers
 * away), while `MEMBER` and `COLLABORATOR` both include read-only accounts.
 *
 * Every doubt refuses: a login that is not one, a role the env does not name
 * correctly, an answer GitHub would not give.
 *
 * @module
 */

import { GITHUB_LOGIN } from "@zuke/gh";

/**
 * A repository role a commenter may hold, as GitHub's collaborators API
 * reports it (`role_name`) — see `ReviewCommandSettings.role`.
 */
export type CommandRole = "read" | "triage" | "write" | "maintain" | "admin";

/**
 * The roles least to most capable. A command's minimum role admits it and
 * everything after it.
 */
const ROLES: readonly CommandRole[] = [
  "read",
  "triage",
  "write",
  "maintain",
  "admin",
];

/** The env var the command job sets to the commenter's login. */
export const REVIEW_ACTOR_ENV = "ZUKE_REVIEW_ACTOR";

/** The env var the command job sets to the least role that may start a run. */
export const REVIEW_ROLE_ENV = "ZUKE_REVIEW_ROLE";

/**
 * The env var the command job sets to the logins admitted whatever their
 * role, comma-separated; absent when there are none.
 */
export const REVIEW_USERS_ENV = "ZUKE_REVIEW_USERS";

/** A commenter's standing, as the collaborators API reports it. */
export interface Standing {
  /** The base permission level: `admin`, `write`, `read`, `none`. */
  permission: string;
  /** The role's name — a built-in one, or a custom role's own. */
  roleName: string;
}

/** Whether the commenter may start a review, and the line that says why. */
export interface CallerVerdict {
  /** Whether the review may start. */
  allowed: boolean;
  /** Why — for the job log. */
  reason: string;
}

/** The command job's description of its caller, as the env carries it. */
export interface CommandCaller {
  /** The commenter's login, as the event reports it. */
  actor: string;
  /** The least role that may start a run, or `undefined` when unreadable. */
  role: CommandRole | undefined;
  /** Logins admitted whatever their role. */
  users: readonly string[];
}

/**
 * The caller the env describes. A role the env names that is not one reads
 * as `undefined`, which {@link mayStartReview} refuses; an absent role is the
 * default, `write`.
 */
export function commandCaller(
  env: (name: string) => string | undefined,
): CommandCaller {
  const declared = env(REVIEW_ROLE_ENV);
  const role = declared === undefined || declared === ""
    ? "write"
    : ROLES.find((r) => r === declared);
  const users = (env(REVIEW_USERS_ENV) ?? "")
    .split(",")
    .map((login) => login.trim())
    .filter((login) => login !== "");
  return { actor: env(REVIEW_ACTOR_ENV) ?? "", role, users };
}

/**
 * The permission levels a custom role may be built on and still be admitted:
 * a custom repository role reports its own name as the role and its base
 * level as the permission, so the base is admitted when the floor lies at or
 * below it — `admin` always, `write` unless the floor is above it, `read`
 * only for a `read` floor. A triage floor cannot recognise a read-based custom
 * role as triage-like, and refuses it.
 */
function admittedBases(role: CommandRole): readonly string[] {
  if (role === "read") return ["admin", "write", "read"];
  if (role === "triage" || role === "write") return ["admin", "write"];
  return ["admin"];
}

/**
 * Whether `caller` may start a review. `lookup` asks GitHub for the
 * commenter's standing and is called only when the login is neither invalid
 * nor named outright; a lookup that throws refuses — an answer that cannot be
 * read is not a yes.
 */
export async function mayStartReview(
  caller: CommandCaller,
  lookup: (login: string) => Promise<Standing>,
): Promise<CallerVerdict> {
  const { actor, role, users } = caller;
  if (!GITHUB_LOGIN.test(actor)) {
    return {
      allowed: false,
      reason: "the commenter's login is not a GitHub login",
    };
  }
  if (role === undefined) {
    return {
      allowed: false,
      reason: `${REVIEW_ROLE_ENV} names no role GitHub has; refusing the run`,
    };
  }
  if (users.includes(actor)) {
    return {
      allowed: true,
      reason: `${actor} is named as allowed to start a review`,
    };
  }
  let standing: Standing;
  try {
    standing = await lookup(actor);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      allowed: false,
      reason: `could not read ${actor}'s role; refusing the run (${message})`,
    };
  }
  const admitted = ROLES.slice(ROLES.indexOf(role));
  if (admitted.some((r) => r === standing.roleName)) {
    return {
      allowed: true,
      reason: `${actor} has the ${standing.roleName} role`,
    };
  }
  if (admittedBases(role).includes(standing.permission)) {
    return {
      allowed: true,
      reason: `${actor} has the ${standing.roleName} role, with ` +
        `${standing.permission} access`,
    };
  }
  return {
    allowed: false,
    reason: `${actor} has the ${standing.roleName} role; starting a review ` +
      `needs ${role} or above`,
  };
}
