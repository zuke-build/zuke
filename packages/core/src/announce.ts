/**
 * `AnnounceTasks` — post build announcements to chat platforms (Slack, Microsoft
 * Teams, Discord) from a pipeline, via each platform's *incoming webhook*. The
 * one-liners a build reaches for — "build succeeded", "build failed", "package
 * published", "service deployed" — rendered with a level-driven accent colour
 * and icon, plus optional detail fields and an action link.
 *
 * Like {@link "./file.ts" | FileTasks}, these run no subprocess, so the methods
 * take direct arguments rather than a settings-lambda. They are built on the
 * platform `fetch` with an injectable `fetch` seam so they can be unit-tested
 * without network access.
 *
 * Slack also supports a bot-token mode: set {@link SlackAnnounceOptions.token}
 * to post through the Web API (`chat.postMessage`) and pass the channel as the
 * first argument instead of a webhook URL.
 *
 * A webhook URL (or bot token) embeds the secret that authorises posting to a
 * channel, so it should come from a {@link "./params.ts" | secret parameter}
 * rather than being hard-coded:
 *
 * ```ts
 * import { AnnounceTasks, Build, parameter, target } from "jsr:@zuke/core";
 *
 * class MyBuild extends Build {
 *   slack = parameter("Slack incoming-webhook URL").secret().required();
 *
 *   deploy = target()
 *     .requires(this.slack)
 *     .executes(async () => {
 *       // ... deploy ...
 *       await AnnounceTasks.slack(this.slack.value, {
 *         title: "Deploy",
 *         text: "Shipped api@1.4.0 to production.",
 *         level: "success",
 *         fields: [{ name: "Service", value: "api" }],
 *         link: { text: "Release notes", url: "https://example.com/r/1.4.0" },
 *       });
 *     });
 * }
 * ```
 *
 * A non-2xx response throws an {@link HttpError} carrying the status.
 *
 * @module
 */

import { HttpError } from "./http.ts";

/**
 * The outcome an announcement conveys. It drives the accent colour and the icon
 * prepended to the message; defaults to `"info"` when omitted.
 */
export type AnnouncementLevel = "success" | "failure" | "warning" | "info";

/** A labelled detail rendered beside the message (e.g. a version or environment). */
export interface AnnouncementField {
  /** The label of the detail. */
  name: string;
  /** The value of the detail. */
  value: string;
}

/** A clickable action rendered with the announcement (e.g. a link to a release). */
export interface AnnouncementLink {
  /** The link text. */
  text: string;
  /** The destination URL. */
  url: string;
}

/**
 * A structured announcement. A bare `string` passed to a task is shorthand for
 * `{ text }` at the default `"info"` {@link AnnouncementLevel | level}.
 */
export interface Announcement {
  /** The main message body. */
  text: string;
  /** An optional heading shown above the body. */
  title?: string;
  /** The outcome the message conveys (default `"info"`). */
  level?: AnnouncementLevel;
  /** Optional labelled details rendered beside the body. */
  fields?: AnnouncementField[];
  /** An optional action link rendered with the message. */
  link?: AnnouncementLink;
}

/** Options shared by the announce tasks. */
export interface AnnounceOptions {
  /**
   * Override the display name the message is posted under. Honoured by Slack and
   * Discord webhooks; ignored by Teams, which has no equivalent field.
   */
  username?: string;
  /**
   * The `fetch` implementation to use. Defaults to the global `fetch`; override
   * it to unit-test without network access.
   */
  fetch?: typeof fetch;
}

/** Options for {@link AnnounceTasksApi.slack}, adding bot-token mode. */
export interface SlackAnnounceOptions extends AnnounceOptions {
  /**
   * A Slack bot token (`xoxb-…`). Set it to post through the Slack Web API
   * (`chat.postMessage`) instead of an incoming webhook — the first argument is
   * then the channel id or name to post to rather than a webhook URL. Source it
   * from a secret parameter; Zuke masks it in CI output.
   */
  token?: string;
}

/**
 * Raised when the Slack Web API accepts the request but reports a logical
 * failure (`{ ok: false }`), carrying Slack's machine-readable error code (e.g.
 * `channel_not_found`, `not_in_channel`, `invalid_auth`).
 */
export class SlackApiError extends Error {
  override name = "SlackApiError";
  constructor(
    /** Slack's `error` code from the `chat.postMessage` response. */
    readonly error: string,
  ) {
    super(`Slack chat.postMessage failed: ${error}`);
  }
}

/** The accent (hex colour + icon) used to render each {@link AnnouncementLevel}. */
const ACCENTS: Record<AnnouncementLevel, { hex: string; emoji: string }> = {
  success: { hex: "2eb886", emoji: "✅" },
  failure: { hex: "cc0000", emoji: "❌" },
  warning: { hex: "daa038", emoji: "⚠️" },
  info: { hex: "2f81f7", emoji: "ℹ️" },
};

/** Coerce the shorthand `string` form into an {@link Announcement}. */
function asAnnouncement(message: Announcement | string): Announcement {
  return typeof message === "string" ? { text: message } : message;
}

/** Build the JSON payload for a Slack incoming webhook. */
function slackPayload(
  ann: Announcement,
  options: AnnounceOptions,
): Record<string, unknown> {
  const { hex, emoji } = ACCENTS[ann.level ?? "info"];
  const lines = [`${emoji} ${ann.text}`];
  if (ann.link) lines.push(`<${ann.link.url}|${ann.link.text}>`);
  const attachment: Record<string, unknown> = {
    color: `#${hex}`,
    text: lines.join("\n"),
  };
  if (ann.title !== undefined) attachment.title = ann.title;
  if (ann.fields?.length) {
    attachment.fields = ann.fields.map((f) => ({
      title: f.name,
      value: f.value,
      short: true,
    }));
  }
  const payload: Record<string, unknown> = { attachments: [attachment] };
  if (options.username !== undefined) payload.username = options.username;
  return payload;
}

/** Build the JSON payload for a Discord webhook. */
function discordPayload(
  ann: Announcement,
  options: AnnounceOptions,
): Record<string, unknown> {
  const { hex, emoji } = ACCENTS[ann.level ?? "info"];
  const description = ann.link
    ? `${emoji} ${ann.text}\n[${ann.link.text}](${ann.link.url})`
    : `${emoji} ${ann.text}`;
  const embed: Record<string, unknown> = {
    description,
    color: Number.parseInt(hex, 16),
  };
  if (ann.title !== undefined) embed.title = ann.title;
  if (ann.fields?.length) {
    embed.fields = ann.fields.map((f) => ({
      name: f.name,
      value: f.value,
      inline: true,
    }));
  }
  const payload: Record<string, unknown> = { embeds: [embed] };
  if (options.username !== undefined) payload.username = options.username;
  return payload;
}

/** Build the JSON payload for a Microsoft Teams incoming webhook (MessageCard). */
function teamsPayload(ann: Announcement): Record<string, unknown> {
  const { hex, emoji } = ACCENTS[ann.level ?? "info"];
  const card: Record<string, unknown> = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor: hex,
    summary: ann.title ?? ann.text,
    text: `${emoji} ${ann.text}`,
  };
  if (ann.title !== undefined) card.title = ann.title;
  if (ann.fields?.length) {
    card.sections = [{
      facts: ann.fields.map((f) => ({ name: f.name, value: f.value })),
    }];
  }
  if (ann.link) {
    card.potentialAction = [{
      "@type": "OpenUri",
      name: ann.link.text,
      targets: [{ os: "default", uri: ann.link.url }],
    }];
  }
  return card;
}

/** POST a JSON payload to a webhook URL, throwing {@link HttpError} on non-2xx. */
async function post(
  url: string,
  payload: Record<string, unknown>,
  options: AnnounceOptions,
): Promise<void> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  // Drain the body so the connection can be reused/closed.
  await response.body?.cancel();
  if (!response.ok) throw new HttpError(response.status, url);
}

/** The Slack Web API `chat.postMessage` endpoint. */
const SLACK_POST_MESSAGE = "https://slack.com/api/chat.postMessage";

/**
 * Post via the Slack Web API (`chat.postMessage`) using a bot token. Unlike a
 * webhook, the API answers `200` even on a logical failure, so the `ok` flag in
 * the JSON body is checked and surfaced as a {@link SlackApiError}.
 */
async function postSlackBot(
  token: string,
  channel: string,
  ann: Announcement,
  options: SlackAnnounceOptions,
): Promise<void> {
  const doFetch = options.fetch ?? fetch;
  const payload = { channel, ...slackPayload(ann, options) };
  const response = await doFetch(SLACK_POST_MESSAGE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(response.status, SLACK_POST_MESSAGE);
  }
  const result: { ok?: boolean; error?: string } = await response.json();
  if (result.ok !== true) {
    throw new SlackApiError(result.error ?? "unknown_error");
  }
}

/** The shape of {@link AnnounceTasks}. */
export interface AnnounceTasksApi {
  /**
   * Post `message` to Slack. By default `destination` is an incoming-webhook URL
   * (the URL embeds the secret, so source it from a secret parameter). Set
   * {@link SlackAnnounceOptions.token} to post through the Web API
   * (`chat.postMessage`) with a bot token instead — `destination` is then the
   * channel id or name. A bare string is shorthand for an `"info"` announcement.
   *
   * @throws {HttpError} on a non-2xx HTTP response.
   * @throws {SlackApiError} when the Web API reports `{ ok: false }` (bot mode).
   */
  slack(
    destination: string,
    message: Announcement | string,
    options?: SlackAnnounceOptions,
  ): Promise<void>;

  /**
   * Post `message` to a Microsoft Teams channel via its incoming-webhook
   * `webhookUrl`. {@link AnnounceOptions.username} has no Teams equivalent and
   * is ignored.
   */
  teams(
    webhookUrl: string,
    message: Announcement | string,
    options?: AnnounceOptions,
  ): Promise<void>;

  /**
   * Post `message` to a Discord channel via its webhook `webhookUrl` (the URL
   * embeds the token, so source it from a secret parameter).
   */
  discord(
    webhookUrl: string,
    message: Announcement | string,
    options?: AnnounceOptions,
  ): Promise<void>;
}

/** Announcement task functions for posting build status to chat platforms. */
export const AnnounceTasks: AnnounceTasksApi = {
  slack(
    destination: string,
    message: Announcement | string,
    options: SlackAnnounceOptions = {},
  ): Promise<void> {
    const ann = asAnnouncement(message);
    if (options.token !== undefined) {
      return postSlackBot(options.token, destination, ann, options);
    }
    return post(destination, slackPayload(ann, options), options);
  },

  teams(
    webhookUrl: string,
    message: Announcement | string,
    options: AnnounceOptions = {},
  ): Promise<void> {
    return post(webhookUrl, teamsPayload(asAnnouncement(message)), options);
  },

  discord(
    webhookUrl: string,
    message: Announcement | string,
    options: AnnounceOptions = {},
  ): Promise<void> {
    return post(
      webhookUrl,
      discordPayload(asAnnouncement(message), options),
      options,
    );
  },
};
