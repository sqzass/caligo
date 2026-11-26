const clean = (s, max = 120, empty = "—") => {
  const t = String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!t) return empty;
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let b = {};
  try { b = await request.json(); } catch (e) {}
  const tool = clean(b.tool, 40, "tool"), ok = b.ok !== false;
  const bot = clean(b.bot, 40, "unknown bot"), plat = clean(b.from, 20, "");
  const embed = {
    title: (ok ? "🔧 " : "⚠️ ") + tool,
    color: ok ? 0x3fbf7f : 0xe5484d,
    description: (clean(b.summary, 300, "") || clean(b.args, 300, "no details")).slice(0, 400),
    fields: [
      { name: "Bot", value: (bot + (plat ? ` (${plat})` : "")).slice(0, 128), inline: true },
      ...(b.args ? [{ name: "Args", value: clean(b.args, 500).slice(0, 900), inline: false }] : []),
      ...(b.ms != null ? [{ name: "Took", value: String(Math.max(0, Math.round(b.ms))) + "ms", inline: true }] : []),
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "caligocs.pages.dev /api/log" },
  };
  try {
    const hook = (env && (env.DISCORD_WEBHOOK_URL || env.DISCORD_WEBHOOK)) || "";
    if (typeof hook === "string" && hook.startsWith("https://")) {
      const p = fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ embeds: [embed] }) }).catch(() => {});
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
    }
  } catch (e) {}
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

