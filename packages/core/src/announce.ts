/**
 * `AnnounceTasks` — post build announcements to chat platforms (Slack, Microsoft
 * Teams, Discord) from a pipeline, via each platform's *incoming webhook*. The
 * one-liners a build reaches for — "build succeeded", "build failed", "package
 * published", "service deployed" — rendered with a level-driven accent colour
 * and icon, plus optional detail fields and an action link.
 *
 * Each task follows the same construct-configure-run shape as Zuke's tool
 * wrappers: it takes a settings-lambda that configures a fluent settings object
 * and returns it. The settings run no subprocess — they POST over the platform
 * `fetch`, with a `.fetch()` seam so they can be unit-tested without network
 * access.
 *
 * A webhook URL (or a Slack bot token) embeds the secret that authorises posting
 * to a channel, so it should come from a {@link "./params.ts" | secret
 * parameter} rather than being hard-coded:
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
 *       await AnnounceTasks.slack((s) =>
 *         s.webhook(this.slack.value)
 *           .title("Deploy")
 *           .text("Shipped api@1.4.0 to production.")
 *           .success()
 *           .field("Service", "api")
 *           .link("Release notes", "https://example.com/r/1.4.0")
 *       );
 *     });
 * }
 * ```
 *
 * Slack also speaks bot tokens: `s.bot().token(t).channel("#builds")` posts
 * through the Web API (`chat.postMessage`) instead of a webhook.
 *
 * A non-2xx response throws an {@link HttpError} carrying the status; a
 * misconfigured settings object throws an {@link AnnounceError}.
 *
 * @module
 */

import { HttpError } from "./http.ts";
import type { Configure } from "./tooling.ts";

/**
 * The outcome an announcement conveys. It drives the accent colour and the icon
 * prepended to the message; defaults to `"info"`.
 */
export type AnnouncementLevel = "success" | "failure" | "warning" | "info";

/** A labelled detail rendered beside the message (e.g. a version or environment). */
interface AnnouncementField {
  name: string;
  value: string;
}

/** A clickable action rendered with the announcement (e.g. a link to a release). */
interface AnnouncementLink {
  text: string;
  url: string;
}

/** A structured announcement assembled by an {@link AnnouncementSettings}. */
interface Announcement {
  text: string;
  title?: string;
  level: AnnouncementLevel;
  fields?: AnnouncementField[];
  link?: AnnouncementLink;
}

/** Raised when an announcement is run before it is fully configured. */
export class AnnounceError extends Error {
  override name = "AnnounceError";
  constructor(message: string) {
    super(message);
  }
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

/** Build the JSON payload for a Slack incoming webhook / Web API call. */
function slackPayload(
  ann: Announcement,
  username?: string,
): Record<string, unknown> {
  const { hex, emoji } = ACCENTS[ann.level];
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
  if (username !== undefined) payload.username = username;
  return payload;
}

/** Build the JSON payload for a Discord webhook. */
function discordPayload(
  ann: Announcement,
  username?: string,
): Record<string, unknown> {
  const { hex, emoji } = ACCENTS[ann.level];
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
  if (username !== undefined) payload.username = username;
  return payload;
}

/** Build the JSON payload for a Microsoft Teams incoming webhook (MessageCard). */
function teamsPayload(ann: Announcement): Record<string, unknown> {
  const { hex, emoji } = ACCENTS[ann.level];
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
  doFetch?: typeof fetch,
): Promise<void> {
  const response = await (doFetch ?? fetch)(url, {
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
  username?: string,
  doFetch?: typeof fetch,
): Promise<void> {
  const payload = { channel, ...slackPayload(ann, username) };
  const response = await (doFetch ?? fetch)(SLACK_POST_MESSAGE, {
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

/**
 * Fluent settings shared by every announcement: the message content (a body, an
 * optional title, a {@link AnnouncementLevel | level}, repeatable detail fields
 * and an action link), an optional display name, the webhook destination, and a
 * `fetch` seam for tests. All chainers return `this`. Subclasses add any
 * platform-specific configuration and render the payload.
 */
export abstract class AnnouncementSettings {
  protected text_ = "";
  protected title_?: string;
  protected level_: AnnouncementLevel = "info";
  protected readonly fields_: AnnouncementField[] = [];
  protected link_?: AnnouncementLink;
  protected username_?: string;
  protected webhookUrl_?: string;
  protected fetch_?: typeof fetch;

  /** Set the main message body. */
  text(text: string): this {
    this.text_ = text;
    return this;
  }

  /** Set an optional heading shown above the body. */
  title(title: string): this {
    this.title_ = title;
    return this;
  }

  /** Set the outcome the message conveys (default `"info"`). */
  level(level: AnnouncementLevel): this {
    this.level_ = level;
    return this;
  }

  /** Shorthand for `.level("success")`. */
  success(): this {
    return this.level("success");
  }

  /** Shorthand for `.level("failure")`. */
  failure(): this {
    return this.level("failure");
  }

  /** Shorthand for `.level("warning")`. */
  warning(): this {
    return this.level("warning");
  }

  /** Shorthand for `.level("info")`. */
  info(): this {
    return this.level("info");
  }

  /** Add a labelled detail rendered beside the body. Repeatable. */
  field(name: string, value: string): this {
    this.fields_.push({ name, value });
    return this;
  }

  /** Set an action link rendered with the message. */
  link(text: string, url: string): this {
    this.link_ = { text, url };
    return this;
  }

  /**
   * Override the display name the message is posted under. Honoured by Slack and
   * Discord; ignored by Teams, which has no equivalent field.
   */
  username(name: string): this {
    this.username_ = name;
    return this;
  }

  /**
   * Set the incoming-webhook URL to post to. The URL embeds the secret, so
   * source it from a secret parameter.
   */
  webhook(url: string): this {
    this.webhookUrl_ = url;
    return this;
  }

  /**
   * The `fetch` implementation to use. Defaults to the global `fetch`; override
   * it to unit-test without network access.
   */
  fetch(impl: typeof fetch): this {
    this.fetch_ = impl;
    return this;
  }

  /** The structured announcement assembled so far. */
  protected announcement(): Announcement {
    const ann: Announcement = { text: this.text_, level: this.level_ };
    if (this.title_ !== undefined) ann.title = this.title_;
    if (this.fields_.length > 0) ann.fields = this.fields_;
    if (this.link_ !== undefined) ann.link = this.link_;
    return ann;
  }

  /** The webhook URL, or an {@link AnnounceError} if one was never set. */
  protected requireWebhook(): string {
    if (this.webhookUrl_ === undefined) {
      throw new AnnounceError(
        "no destination set; call .webhook(url) before running the announcement",
      );
    }
    return this.webhookUrl_;
  }

  /** The platform-native JSON payload for this announcement. */
  protected abstract payload(): Record<string, unknown>;

  /** Send the announcement. Posts the {@link payload} to the webhook by default. */
  send(): Promise<void> {
    return post(this.requireWebhook(), this.payload(), this.fetch_);
  }
}

/** Fluent settings for {@link AnnounceTasksApi.slack}, adding bot-token mode. */
export class SlackAnnouncementSettings extends AnnouncementSettings {
  #bot = false;
  #token?: string;
  #channel?: string;

  /**
   * Post through the Slack Web API (`chat.postMessage`) with a bot token instead
   * of an incoming webhook. Pair with {@link token} and {@link channel}.
   */
  bot(): this {
    this.#bot = true;
    return this;
  }

  /**
   * Set the Slack bot token (`xoxb-…`) for bot mode. Source it from a secret
   * parameter; Zuke masks it in CI output. Implies {@link bot}.
   */
  token(token: string): this {
    this.#token = token;
    return this;
  }

  /** Set the channel id or name to post to in bot mode. */
  channel(channel: string): this {
    this.#channel = channel;
    return this;
  }

  protected override payload(): Record<string, unknown> {
    return slackPayload(this.announcement(), this.username_);
  }

  override send(): Promise<void> {
    if (!this.#bot && this.#token === undefined) {
      return super.send();
    }
    const token = this.#token;
    if (token === undefined) {
      throw new AnnounceError("bot mode needs a token; call .token(...)");
    }
    const channel = this.#channel;
    if (channel === undefined) {
      throw new AnnounceError("bot mode needs a channel; call .channel(...)");
    }
    return postSlackBot(
      token,
      channel,
      this.announcement(),
      this.username_,
      this.fetch_,
    );
  }
}

/** Fluent settings for {@link AnnounceTasksApi.teams}. */
export class TeamsAnnouncementSettings extends AnnouncementSettings {
  protected override payload(): Record<string, unknown> {
    return teamsPayload(this.announcement());
  }
}

/** Fluent settings for {@link AnnounceTasksApi.discord}. */
export class DiscordAnnouncementSettings extends AnnouncementSettings {
  protected override payload(): Record<string, unknown> {
    return discordPayload(this.announcement(), this.username_);
  }
}

/** Construct the settings, apply the lambda, and send. */
function runAnnouncement<S extends AnnouncementSettings>(
  settings: S,
  configure?: Configure<S>,
): Promise<void> {
  return (configure ? configure(settings) : settings).send();
}

/** The shape of {@link AnnounceTasks}. */
export interface AnnounceTasksApi {
  /**
   * Announce to Slack. Configure a {@link SlackAnnouncementSettings}: set a
   * `.webhook(url)` (or `.bot().token(t).channel(c)` for the Web API) and the
   * message content.
   */
  slack(configure?: Configure<SlackAnnouncementSettings>): Promise<void>;

  /**
   * Announce to Microsoft Teams. Configure a {@link TeamsAnnouncementSettings}:
   * set a `.webhook(url)` and the message content.
   */
  teams(configure?: Configure<TeamsAnnouncementSettings>): Promise<void>;

  /**
   * Announce to Discord. Configure a {@link DiscordAnnouncementSettings}: set a
   * `.webhook(url)` and the message content.
   */
  discord(configure?: Configure<DiscordAnnouncementSettings>): Promise<void>;
}

/** Announcement task functions for posting build status to chat platforms. */
export const AnnounceTasks: AnnounceTasksApi = {
  slack(configure?: Configure<SlackAnnouncementSettings>): Promise<void> {
    return runAnnouncement(new SlackAnnouncementSettings(), configure);
  },

  teams(configure?: Configure<TeamsAnnouncementSettings>): Promise<void> {
    return runAnnouncement(new TeamsAnnouncementSettings(), configure);
  },

  discord(configure?: Configure<DiscordAnnouncementSettings>): Promise<void> {
    return runAnnouncement(new DiscordAnnouncementSettings(), configure);
  },
};
