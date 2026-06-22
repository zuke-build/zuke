import { assertEquals, assertRejects } from "./_assert.ts";
import {
  type Announcement,
  AnnounceTasks,
  SlackApiError,
} from "../src/announce.ts";
import { HttpError } from "../src/http.ts";

/** A recorded webhook call with its URL and parsed JSON body. */
interface Call {
  url: string;
  init?: RequestInit;
  body: Record<string, unknown>;
}

/** A fake `fetch` returning `status`, recording each call and its JSON body. */
function fakeFetch(
  status = 200,
  body: BodyInit | null = "ok",
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    calls.push({ url: String(input), init, body: JSON.parse(raw) });
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

Deno.test("slack posts a JSON info card for a bare string message", async () => {
  const { fetch, calls } = fakeFetch();
  await AnnounceTasks.slack("https://hooks.slack.com/x", "Build passed", {
    fetch,
  });
  assertEquals(calls[0].url, "https://hooks.slack.com/x");
  assertEquals(calls[0].init?.method, "POST");
  assertEquals(calls[0].init?.headers, { "Content-Type": "application/json" });
  const [attachment] = calls[0].body.attachments as Record<string, unknown>[];
  assertEquals(attachment.color, "#2f81f7"); // info
  assertEquals(attachment.text, "ℹ️ Build passed");
  assertEquals("title" in attachment, false);
  assertEquals("fields" in attachment, false);
  assertEquals("username" in calls[0].body, false);
});

Deno.test("slack renders title, success colour, fields, link and username", async () => {
  const { fetch, calls } = fakeFetch();
  const message: Announcement = {
    title: "Deploy",
    text: "Shipped api@1.4.0",
    level: "success",
    fields: [{ name: "Service", value: "api" }],
    link: { text: "Notes", url: "https://example.com/r" },
  };
  await AnnounceTasks.slack("https://hooks.slack.com/x", message, {
    fetch,
    username: "ci-bot",
  });
  const [attachment] = calls[0].body.attachments as Record<string, unknown>[];
  assertEquals(attachment.color, "#2eb886"); // success
  assertEquals(attachment.title, "Deploy");
  assertEquals(
    attachment.text,
    "✅ Shipped api@1.4.0\n<https://example.com/r|Notes>",
  );
  assertEquals(attachment.fields, [
    { title: "Service", value: "api", short: true },
  ]);
  assertEquals(calls[0].body.username, "ci-bot");
});

Deno.test("discord posts an embed with an integer colour", async () => {
  const { fetch, calls } = fakeFetch(204, null); // Discord replies 204, no body
  const message: Announcement = {
    title: "CI",
    text: "Build failed",
    level: "failure",
    fields: [{ name: "Job", value: "test" }],
    link: { text: "Logs", url: "https://example.com/l" },
  };
  await AnnounceTasks.discord("https://discord.com/api/webhooks/x", message, {
    fetch,
    username: "ci-bot",
  });
  const [embed] = calls[0].body.embeds as Record<string, unknown>[];
  assertEquals(embed.title, "CI");
  assertEquals(embed.color, 0xcc0000); // failure as a decimal integer
  assertEquals(
    embed.description,
    "❌ Build failed\n[Logs](https://example.com/l)",
  );
  assertEquals(embed.fields, [{ name: "Job", value: "test", inline: true }]);
  assertEquals(calls[0].body.username, "ci-bot");
});

Deno.test("discord omits optional fields for a bare string", async () => {
  const { fetch, calls } = fakeFetch();
  await AnnounceTasks.discord("https://discord.com/api/webhooks/x", "Hi", {
    fetch,
  });
  const [embed] = calls[0].body.embeds as Record<string, unknown>[];
  assertEquals(embed.description, "ℹ️ Hi");
  assertEquals(embed.color, 0x2f81f7);
  assertEquals("title" in embed, false);
  assertEquals("fields" in embed, false);
  assertEquals("username" in calls[0].body, false);
});

Deno.test("teams posts a MessageCard with facts and an action", async () => {
  const { fetch, calls } = fakeFetch();
  const message: Announcement = {
    title: "Release",
    text: "Published @zuke/core@2.0.0",
    level: "warning",
    fields: [{ name: "Version", value: "2.0.0" }],
    link: { text: "Changelog", url: "https://example.com/c" },
  };
  await AnnounceTasks.teams("https://outlook.office.com/webhook/x", message, {
    fetch,
    username: "ignored", // Teams has no username field
  });
  const card = calls[0].body;
  assertEquals(card["@type"], "MessageCard");
  assertEquals(card.themeColor, "daa038"); // warning, no leading '#'
  assertEquals(card.summary, "Release");
  assertEquals(card.title, "Release");
  assertEquals(card.text, "⚠️ Published @zuke/core@2.0.0");
  assertEquals(card.sections, [{
    facts: [{ name: "Version", value: "2.0.0" }],
  }]);
  assertEquals(card.potentialAction, [{
    "@type": "OpenUri",
    name: "Changelog",
    targets: [{ os: "default", uri: "https://example.com/c" }],
  }]);
  assertEquals("username" in card, false);
});

Deno.test("teams summary falls back to the text when there is no title", async () => {
  const { fetch, calls } = fakeFetch();
  await AnnounceTasks.teams("https://outlook.office.com/webhook/x", "Done", {
    fetch,
  });
  const card = calls[0].body;
  assertEquals(card.summary, "Done");
  assertEquals("title" in card, false);
  assertEquals("sections" in card, false);
  assertEquals("potentialAction" in card, false);
});

Deno.test("a non-2xx webhook response throws HttpError carrying the status", async () => {
  const { fetch } = fakeFetch(400);
  const error = await assertRejects(
    () => AnnounceTasks.slack("https://hooks.slack.com/bad", "x", { fetch }),
    HttpError,
    "HTTP 400",
  );
  if (error instanceof HttpError) {
    assertEquals(error.status, 400);
    assertEquals(error.url, "https://hooks.slack.com/bad");
  }
});

Deno.test("slack bot-token mode posts to chat.postMessage with the channel", async () => {
  const { fetch, calls } = fakeFetch(200, '{"ok":true}');
  const message: Announcement = {
    text: "Build passed",
    level: "success",
    fields: [{ name: "Branch", value: "main" }],
  };
  await AnnounceTasks.slack("#builds", message, {
    fetch,
    token: "xoxb-123",
    username: "ci-bot",
  });
  assertEquals(calls[0].url, "https://slack.com/api/chat.postMessage");
  assertEquals(calls[0].init?.method, "POST");
  assertEquals(calls[0].init?.headers, {
    "Content-Type": "application/json; charset=utf-8",
    Authorization: "Bearer xoxb-123",
  });
  assertEquals(calls[0].body.channel, "#builds");
  assertEquals(calls[0].body.username, "ci-bot");
  const [attachment] = calls[0].body.attachments as Record<string, unknown>[];
  assertEquals(attachment.color, "#2eb886");
  assertEquals(attachment.text, "✅ Build passed");
});

Deno.test("slack bot-token mode surfaces a Slack error code", async () => {
  const { fetch } = fakeFetch(200, '{"ok":false,"error":"channel_not_found"}');
  const error = await assertRejects(
    () => AnnounceTasks.slack("#nope", "hi", { fetch, token: "xoxb-123" }),
    SlackApiError,
    "channel_not_found",
  );
  if (error instanceof SlackApiError) {
    assertEquals(error.error, "channel_not_found");
  }
});

Deno.test("slack bot-token mode reports unknown_error when none is given", async () => {
  const { fetch } = fakeFetch(200, '{"ok":false}');
  const error = await assertRejects(
    () => AnnounceTasks.slack("#nope", "hi", { fetch, token: "xoxb-123" }),
    SlackApiError,
    "unknown_error",
  );
  if (error instanceof SlackApiError) {
    assertEquals(error.error, "unknown_error");
  }
});

Deno.test("slack bot-token mode throws HttpError on a non-2xx response", async () => {
  const { fetch } = fakeFetch(429, "rate limited");
  const error = await assertRejects(
    () => AnnounceTasks.slack("#builds", "hi", { fetch, token: "xoxb-123" }),
    HttpError,
    "HTTP 429",
  );
  if (error instanceof HttpError) {
    assertEquals(error.status, 429);
    assertEquals(error.url, "https://slack.com/api/chat.postMessage");
  }
});
