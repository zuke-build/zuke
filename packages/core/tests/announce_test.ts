import { assertEquals, assertRejects } from "./_assert.ts";
import {
  AnnounceError,
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

Deno.test("slack posts a JSON info card for a minimal message", async () => {
  const { fetch, calls } = fakeFetch();
  await AnnounceTasks.slack((s) =>
    s.fetch(fetch).webhook("https://hooks.slack.com/x").text("Build passed")
  );
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
  await AnnounceTasks.slack((s) =>
    s.fetch(fetch)
      .webhook("https://hooks.slack.com/x")
      .title("Deploy")
      .text("Shipped api@1.4.0")
      .success()
      .field("Service", "api")
      .link("Notes", "https://example.com/r")
      .username("ci-bot")
  );
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
  await AnnounceTasks.discord((s) =>
    s.fetch(fetch)
      .webhook("https://discord.com/api/webhooks/x")
      .title("CI")
      .text("Build failed")
      .failure()
      .field("Job", "test")
      .link("Logs", "https://example.com/l")
      .username("ci-bot")
  );
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

Deno.test("the level shortcuts are interchangeable, last one wins", async () => {
  const { fetch, calls } = fakeFetch();
  await AnnounceTasks.slack((s) =>
    s.fetch(fetch).webhook("https://hooks.slack.com/x").text("ok").failure()
      .info()
  );
  const [attachment] = calls[0].body.attachments as Record<string, unknown>[];
  assertEquals(attachment.color, "#2f81f7"); // .info() overrode .failure()
});

Deno.test("discord omits optional fields for a minimal message", async () => {
  const { fetch, calls } = fakeFetch();
  await AnnounceTasks.discord((s) =>
    s.fetch(fetch).webhook("https://discord.com/api/webhooks/x").text("Hi")
  );
  const [embed] = calls[0].body.embeds as Record<string, unknown>[];
  assertEquals(embed.description, "ℹ️ Hi");
  assertEquals(embed.color, 0x2f81f7);
  assertEquals("title" in embed, false);
  assertEquals("fields" in embed, false);
  assertEquals("username" in calls[0].body, false);
});

Deno.test("teams posts a MessageCard with facts and an action", async () => {
  const { fetch, calls } = fakeFetch();
  await AnnounceTasks.teams((s) =>
    s.fetch(fetch)
      .webhook("https://outlook.office.com/webhook/x")
      .title("Release")
      .text("Published @zuke/core@2.0.0")
      .warning()
      .field("Version", "2.0.0")
      .link("Changelog", "https://example.com/c")
      .username("ignored") // Teams has no username field
  );
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
  await AnnounceTasks.teams((s) =>
    s.fetch(fetch).webhook("https://outlook.office.com/webhook/x").text("Done")
  );
  const card = calls[0].body;
  assertEquals(card.summary, "Done");
  assertEquals("title" in card, false);
  assertEquals("sections" in card, false);
  assertEquals("potentialAction" in card, false);
});

Deno.test("a missing webhook destination throws AnnounceError", async () => {
  await assertRejects(
    () => AnnounceTasks.teams((s) => s.text("orphan")),
    AnnounceError,
    "no destination",
  );
});

Deno.test("a non-2xx webhook response throws HttpError carrying the status", async () => {
  const { fetch } = fakeFetch(400);
  const error = await assertRejects(
    () =>
      AnnounceTasks.slack((s) =>
        s.fetch(fetch).webhook("https://hooks.slack.com/bad").text("x")
      ),
    HttpError,
    "HTTP 400",
  );
  if (error instanceof HttpError) {
    assertEquals(error.status, 400);
    assertEquals(error.url, "https://hooks.slack.com/bad");
  }
});

Deno.test("slack runs with no lambda (defaults) and reports the missing webhook", async () => {
  await assertRejects(
    () => AnnounceTasks.slack(),
    AnnounceError,
    "no destination",
  );
});

Deno.test("slack bot mode posts to chat.postMessage with the channel", async () => {
  const { fetch, calls } = fakeFetch(200, '{"ok":true}');
  await AnnounceTasks.slack((s) =>
    s.fetch(fetch)
      .bot()
      .token("xoxb-123")
      .channel("#builds")
      .text("Build passed")
      .success()
      .field("Branch", "main")
      .username("ci-bot")
  );
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

Deno.test("slack bot mode is implied by setting a token", async () => {
  const { fetch, calls } = fakeFetch(200, '{"ok":true}');
  await AnnounceTasks.slack((s) =>
    s.fetch(fetch).token("xoxb-9").channel("#x").text("hi")
  );
  assertEquals(calls[0].url, "https://slack.com/api/chat.postMessage");
});

Deno.test("slack bot mode requires a token", async () => {
  await assertRejects(
    () => AnnounceTasks.slack((s) => s.bot().channel("#x").text("hi")),
    AnnounceError,
    "needs a token",
  );
});

Deno.test("slack bot mode requires a channel", async () => {
  await assertRejects(
    () => AnnounceTasks.slack((s) => s.bot().token("xoxb-1").text("hi")),
    AnnounceError,
    "needs a channel",
  );
});

Deno.test("slack bot mode surfaces a Slack error code", async () => {
  const { fetch } = fakeFetch(200, '{"ok":false,"error":"channel_not_found"}');
  const error = await assertRejects(
    () =>
      AnnounceTasks.slack((s) =>
        s.fetch(fetch).token("xoxb-1").channel("#nope").text("hi")
      ),
    SlackApiError,
    "channel_not_found",
  );
  if (error instanceof SlackApiError) {
    assertEquals(error.error, "channel_not_found");
  }
});

Deno.test("slack bot mode reports unknown_error when none is given", async () => {
  const { fetch } = fakeFetch(200, '{"ok":false}');
  const error = await assertRejects(
    () =>
      AnnounceTasks.slack((s) =>
        s.fetch(fetch).token("xoxb-1").channel("#nope").text("hi")
      ),
    SlackApiError,
    "unknown_error",
  );
  if (error instanceof SlackApiError) {
    assertEquals(error.error, "unknown_error");
  }
});

Deno.test("slack bot mode throws HttpError on a non-2xx response", async () => {
  const { fetch } = fakeFetch(429, "rate limited");
  const error = await assertRejects(
    () =>
      AnnounceTasks.slack((s) =>
        s.fetch(fetch).token("xoxb-1").channel("#builds").text("hi")
      ),
    HttpError,
    "HTTP 429",
  );
  if (error instanceof HttpError) {
    assertEquals(error.status, 429);
    assertEquals(error.url, "https://slack.com/api/chat.postMessage");
  }
});

Deno.test("discord bot mode posts the embed to the REST channel endpoint", async () => {
  const { fetch, calls } = fakeFetch(200, '{"id":"1"}');
  await AnnounceTasks.discord((s) =>
    s.fetch(fetch)
      .bot()
      .token("disc-123")
      .channel("987654321")
      .text("Build failed")
      .failure()
      .username("ignored") // bots post under their own identity
  );
  assertEquals(
    calls[0].url,
    "https://discord.com/api/v10/channels/987654321/messages",
  );
  assertEquals(calls[0].init?.headers, {
    "Content-Type": "application/json",
    Authorization: "Bot disc-123",
  });
  const [embed] = calls[0].body.embeds as Record<string, unknown>[];
  assertEquals(embed.description, "❌ Build failed");
  assertEquals(embed.color, 0xcc0000);
  assertEquals("username" in calls[0].body, false); // not honoured in bot mode
});

Deno.test("discord bot mode throws HttpError on a non-2xx response", async () => {
  const { fetch } = fakeFetch(403, '{"message":"Missing Access"}');
  const error = await assertRejects(
    () =>
      AnnounceTasks.discord((s) =>
        s.fetch(fetch).token("disc-1").channel("1").text("hi")
      ),
    HttpError,
    "HTTP 403",
  );
  if (error instanceof HttpError) {
    assertEquals(error.url, "https://discord.com/api/v10/channels/1/messages");
  }
});

Deno.test("teams bot mode posts HTML to Microsoft Graph", async () => {
  const { fetch, calls } = fakeFetch(201, '{"id":"1"}');
  await AnnounceTasks.teams((s) =>
    s.fetch(fetch)
      .bot()
      .token("graph-tok")
      .team("team-id")
      .channel("19:abc@thread.tacv2")
      .title("Re<lease")
      .text("Shipped A & B")
      .success()
      .field("Ver", "2&0")
      .link("Notes", "https://x/?a=1&b=2")
  );
  assertEquals(
    calls[0].url,
    "https://graph.microsoft.com/v1.0/teams/team-id/channels/19:abc@thread.tacv2/messages",
  );
  assertEquals(calls[0].init?.headers, {
    "Content-Type": "application/json",
    Authorization: "Bearer graph-tok",
  });
  const graphBody = calls[0].body.body as Record<string, unknown>;
  assertEquals(graphBody.contentType, "html");
  assertEquals(
    graphBody.content,
    "<p><strong>✅ Re&lt;lease</strong></p>" +
      "<p>Shipped A &amp; B</p>" +
      "<ul><li><strong>Ver:</strong> 2&amp;0</li></ul>" +
      '<p><a href="https://x/?a=1&amp;b=2">Notes</a></p>',
  );
});

Deno.test("teams bot mode renders a minimal message without a heading title", async () => {
  const { fetch, calls } = fakeFetch(201, '{"id":"1"}');
  await AnnounceTasks.teams((s) =>
    s.fetch(fetch).token("t").team("g").channel("c").text("Done")
  );
  const graphBody = calls[0].body.body as Record<string, unknown>;
  assertEquals(graphBody.content, "<p><strong>ℹ️</strong></p><p>Done</p>");
});

Deno.test("teams bot mode requires a team", async () => {
  await assertRejects(
    () =>
      AnnounceTasks.teams((s) => s.bot().token("t").channel("c").text("hi")),
    AnnounceError,
    "needs a team",
  );
});

Deno.test("teams bot mode throws HttpError on a non-2xx response", async () => {
  const { fetch } = fakeFetch(401, '{"error":"unauthorized"}');
  const error = await assertRejects(
    () =>
      AnnounceTasks.teams((s) =>
        s.fetch(fetch).token("t").team("g").channel("c").text("hi")
      ),
    HttpError,
    "HTTP 401",
  );
  if (error instanceof HttpError) {
    assertEquals(error.status, 401);
  }
});
