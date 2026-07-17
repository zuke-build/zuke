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
 * A webhook URL (or a bot/access token) embeds the secret that authorises
 * posting to a channel, so it should come from a {@link "./params.ts" | secret
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
 * Each platform also speaks an API/bot mode instead of a webhook, opted into
 * with `.bot()`: Slack `chat.postMessage` (`.token(t).channel(c)`), Discord's
 * REST API (`.token(t).channel(c)`), and Microsoft Graph for Teams
 * (`.token(t).team(id).channel(c)`).
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
export interface AnnouncementField {
  /** The field's label. */
  name: string;
  /** The field's value. */
  value: string;
}

/** A clickable action rendered with the announcement (e.g. a link to a release). */
export interface AnnouncementLink {
  /** The link's visible text. */
  text: string;
  /** The link's target URL. */
  url: string;
}

/** A structured announcement assembled by an {@link AnnouncementSettings}. */
export interface Announcement {
  /** The main message body. */
  text: string;
  /** An optional heading rendered above the message. */
  title?: string;
  /** The outcome level driving the accent colour and icon. */
  level: AnnouncementLevel;
  /** Labelled details rendered beside the message. */
  fields?: AnnouncementField[];
  /** A clickable action rendered with the announcement. */
  link?: AnnouncementLink;
}

/** Raised when an announcement is run before it is fully configured. */
export class AnnounceError extends Error {
  /** The error name. */
  override name = "AnnounceError";
  /** Build the error with an explanatory message. */
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
  /** The error name. */
  override name = "SlackApiError";
  /** Build the error from Slack's machine-readable error code. */
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

/**
 * POST a JSON payload to `url`, optionally bearing an `Authorization` header,
 * throwing {@link HttpError} on a non-2xx response.
 */
async function post(
  url: string,
  payload: Record<string, unknown>,
  doFetch?: typeof fetch,
  authorization?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authorization !== undefined) headers.Authorization = authorization;
  const response = await (doFetch ?? fetch)(url, {
    method: "POST",
    headers,
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

/** Base URL of the Discord REST API. */
const DISCORD_API = "https://discord.com/api/v10";

/** The Discord REST endpoint for posting a message to a channel. */
function discordMessagesUrl(channel: string): string {
  return `${DISCORD_API}/channels/${channel}/messages`;
}

/** Base URL of the Microsoft Graph API. */
const GRAPH_API = "https://graph.microsoft.com/v1.0";

/** The Microsoft Graph endpoint for posting a message to a Teams channel. */
function graphMessagesUrl(team: string, channel: string): string {
  return `${GRAPH_API}/teams/${team}/channels/${channel}/messages`;
}

/** Escape the five characters that are unsafe in HTML text or attributes. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Build the Microsoft Graph payload for a Teams channel message, rendering the
 * announcement as HTML (Graph has no MessageCard equivalent).
 */
function teamsGraphPayload(ann: Announcement): Record<string, unknown> {
  const { emoji } = ACCENTS[ann.level];
  const heading = ann.title !== undefined
    ? `${emoji} ${escapeHtml(ann.title)}`
    : emoji;
  const parts = [
    `<p><strong>${heading}</strong></p>`,
    `<p>${escapeHtml(ann.text)}</p>`,
  ];
  if (ann.fields?.length) {
    const items = ann.fields
      .map((f) =>
        `<li><strong>${escapeHtml(f.name)}:</strong> ${
          escapeHtml(f.value)
        }</li>`
      )
      .join("");
    parts.push(`<ul>${items}</ul>`);
  }
  if (ann.link) {
    parts.push(
      `<p><a href="${escapeHtml(ann.link.url)}">${
        escapeHtml(ann.link.text)
      }</a></p>`,
    );
  }
  return { body: { contentType: "html", content: parts.join("") } };
}

/**
 * Fluent settings shared by every announcement: the message content (a body, an
 * optional title, a {@link AnnouncementLevel | level}, repeatable detail fields
 * and an action link), an optional display name, the webhook destination, and a
 * `fetch` seam for tests. All chainers return `this`. Subclasses add any
 * platform-specific configuration and render the payload.
 */
export abstract class AnnouncementSettings {
  /** The main message body. */
  protected text_ = "";
  /** An optional heading shown above the body. */
  protected title_?: string;
  /** The outcome level driving the accent colour and icon. */
  protected level_: AnnouncementLevel = "info";
  /** Repeatable labelled detail fields. */
  protected readonly fields_: AnnouncementField[] = [];
  /** An optional action link rendered with the announcement. */
  protected link_?: AnnouncementLink;
  /** An optional display name for the sender. */
  protected username_?: string;
  /** The webhook destination URL. */
  protected webhookUrl_?: string;
  /** A `fetch` seam injected by tests. */
  protected fetch_?: typeof fetch;
  #bot = false;
  /** An API/bot-mode token, when opted in with `.bot()`. */
  protected token_?: string;
  /** The target channel in API/bot mode. */
  protected channel_?: string;

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

  /**
   * Post through the platform's API with a bot/access token instead of an
   * incoming webhook. Pair with {@link token} and {@link channel}.
   */
  bot(): this {
    this.#bot = true;
    return this;
  }

  /**
   * Set the bot/access token for {@link bot} mode (Slack `xoxb-…`, a Discord bot
   * token, or a Microsoft Graph bearer token). Source it from a secret
   * parameter; Zuke masks it in CI output. Implies {@link bot}.
   */
  token(token: string): this {
    this.token_ = token;
    return this;
  }

  /** Set the channel (id or name) to post to in {@link bot} mode. */
  channel(channel: string): this {
    this.channel_ = channel;
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

  /** Whether the caller opted into bot mode via {@link bot} or {@link token}. */
  protected botRequested(): boolean {
    return this.#bot || this.token_ !== undefined;
  }

  /** The bot/access token, or an {@link AnnounceError} if one was never set. */
  protected requireToken(): string {
    if (this.token_ === undefined) {
      throw new AnnounceError("bot mode needs a token; call .token(...)");
    }
    return this.token_;
  }

  /** The target channel, or an {@link AnnounceError} if one was never set. */
  protected requireChannel(): string {
    if (this.channel_ === undefined) {
      throw new AnnounceError("bot mode needs a channel; call .channel(...)");
    }
    return this.channel_;
  }

  /** The platform-native JSON payload for a webhook post. */
  protected abstract payload(): Record<string, unknown>;

  /** Post through the platform's API in {@link bot} mode. */
  protected abstract sendBot(): Promise<void>;

  /**
   * Send the announcement: through the platform's API when {@link bot} mode was
   * requested, otherwise by posting the {@link payload} to the webhook.
   */
  send(): Promise<void> {
    return this.botRequested()
      ? this.sendBot()
      : post(this.requireWebhook(), this.payload(), this.fetch_);
  }
}

/**
 * Fluent settings for {@link AnnounceTasksApi.slack}. Bot mode
 * (`.bot().token(t).channel(c)`) posts through the Web API (`chat.postMessage`).
 */
export class SlackAnnouncementSettings extends AnnouncementSettings {
  /** Render the Slack webhook payload. */
  protected override payload(): Record<string, unknown> {
    return slackPayload(this.announcement(), this.username_);
  }

  /** Post the announcement through the Slack Web API in bot mode. */
  protected override sendBot(): Promise<void> {
    return postSlackBot(
      this.requireToken(),
      this.requireChannel(),
      this.announcement(),
      this.username_,
      this.fetch_,
    );
  }
}

/**
 * Fluent settings for {@link AnnounceTasksApi.teams}. Bot mode
 * (`.bot().token(t).team(id).channel(c)`) posts through Microsoft Graph with a
 * bearer token.
 */
export class TeamsAnnouncementSettings extends AnnouncementSettings {
  #team?: string;

  /** Set the Teams team (group) id to post to in bot mode (Microsoft Graph). */
  team(team: string): this {
    this.#team = team;
    return this;
  }

  /** Render the Teams webhook payload. */
  protected override payload(): Record<string, unknown> {
    return teamsPayload(this.announcement());
  }

  /** Post the announcement through Microsoft Graph in bot mode. */
  protected override sendBot(): Promise<void> {
    if (this.#team === undefined) {
      throw new AnnounceError("bot mode needs a team; call .team(...)");
    }
    return post(
      graphMessagesUrl(this.#team, this.requireChannel()),
      teamsGraphPayload(this.announcement()),
      this.fetch_,
      `Bearer ${this.requireToken()}`,
    );
  }
}

/**
 * Fluent settings for {@link AnnounceTasksApi.discord}. Bot mode
 * (`.bot().token(t).channel(c)`) posts through the REST API with a bot token.
 */
export class DiscordAnnouncementSettings extends AnnouncementSettings {
  /** Render the Discord webhook payload. */
  protected override payload(): Record<string, unknown> {
    return discordPayload(this.announcement(), this.username_);
  }

  /** Post the announcement through the Discord REST API in bot mode. */
  protected override sendBot(): Promise<void> {
    return post(
      discordMessagesUrl(this.requireChannel()),
      discordPayload(this.announcement()),
      this.fetch_,
      `Bot ${this.requireToken()}`,
    );
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
   * set a `.webhook(url)` (or `.bot().token(t).team(id).channel(c)` to post
   * through Microsoft Graph) and the message content.
   */
  teams(configure?: Configure<TeamsAnnouncementSettings>): Promise<void>;

  /**
   * Announce to Discord. Configure a {@link DiscordAnnouncementSettings}: set a
   * `.webhook(url)` (or `.bot().token(t).channel(c)` to post through the REST
   * API with a bot token) and the message content.
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
