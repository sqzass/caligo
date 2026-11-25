// Cloudflare Pages Function — copy to functions/api/apps.js in the
// caligocs.pages.dev repo, and copy src/appdir/apps.json to data/apps.json
// (repo root). The JSON import below reads ../../data/apps.json relative to
// functions/api/apps.js — or rewrite it to fetch your real dataset / D1 / KV.
//
// Contract (what the CALIGO app_search tool expects):
//   GET /api/apps?query=<text>&platform=<android|ios|windows|macos|linux>&category=<vpn|game|text-editor|...>&limit=<n>&bot=<bot name>&from=<telegram|discord>
//   → 200 JSON: [{name, platforms[], categories[], summary, url?}]
//      (a {results:[...]} wrapper is accepted too)
// Only GET, CORS open. Filtering is duplicated client-side by the bot, so a
// "dumb" endpoint that returns everything also works.
//
// Server-level Discord logging (one ping for every bot that calls this):
//   1. Discord channel → Edit channel → Integrations → Webhooks → New webhook
//      → copy the webhook URL.
//   2. Cloudflare dashboard → Pages → caligocs → Settings →
//      Environment variables → Add variable:
//        name  = DISCORD_WEBHOOK
//        value = the webhook URL you copied
//      Tick "Encrypt" (stored as a secret, never in code), same for
//      Production and Preview if you test preview deploys. Redeploy after.
//      (Or via CLI: wrangler pages secret put DISCORD_WEBHOOK --project-name caligocs)
//   3. Done — every GET fires a fire-and-forget embed, non-blocking.
//      No secret set → no logging, endpoint still works.

import APPS from "../../data/apps.json";

const PLATFORMS = ["android", "ios", "windows", "macos", "linux"];

// Keep the embed tidy: collapse whitespace/newlines, cap length, never empty.
function clean(s, max = 60, empty = "any") {
  const t = String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!t) return empty;
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function fireLog(ctx, info) {
  try {
    const env = (ctx && ctx.env) || {};
    const hook = env.DISCORD_WEBHOOK || env.DISCORD_WEBHOOK || "";
    if (typeof hook !== "string" || !hook.startsWith("https://")) return;
    const q = clean(info.query, 80);
    const plat = clean(info.platform, 20);
    const cat = clean(info.category, 40);
    const bot = clean(info.bot, 40, "unknown bot");
    const src = clean(info.from, 20, "");
    const names = (info.names || []).slice(0, 5).map(n => clean(n, 40)).filter(Boolean);
    const desc =
      `**${q}**` +
      (plat !== "any" ? ` · \`${plat}\`` : "") +
      (cat !== "any" ? ` · \`${cat}\`` : "") +
      `  →  ${info.count} hit${info.count === 1 ? "" : "s"}`;
    const embed = {
      title: "🔍 app_search",
      description: desc.slice(0, 400),
      color: 0x5865f2,
      fields: [
        { name: "Query", value: q.slice(0, 256), inline: true },
        { name: "Platform", value: plat.slice(0, 64), inline: true },
        { name: "Category", value: cat.slice(0, 64), inline: true },
        { name: "Bot", value: (bot + (src && src !== "any" ? ` (${src})` : "")).slice(0, 128), inline: true },
        { name: "Limit", value: String(info.limit), inline: true },
        { name: "Results", value: String(info.count), inline: true },
      ].filter(f => f.value),
      timestamp: new Date().toISOString(),
      footer: { text: "caligocs.pages.dev /api/apps" },
    };
    if (names.length) {
      embed.fields.push({ name: "Top hits", value: names.map((n, i) => `${i + 1}. ${n}`).join("\n").slice(0, 900), inline: false });
    }
    const p = fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    }).catch(() => {});
    // Never delay the API response waiting for Discord.
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
  } catch (e) { /* logging must never break the endpoint */ }
}

export async function onRequestGet(ctx) {
  const request = ctx.request;
  const url = new URL(request.url);
  const query = (url.searchParams.get("query") || "").toLowerCase();
  const platform = (url.searchParams.get("platform") || "").toLowerCase();
  const category = (url.searchParams.get("category") || "").toLowerCase();
  const bot = url.searchParams.get("bot") || "";
  const from = url.searchParams.get("from") || "";
  const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get("limit"), 10) || 20));
  const toks = query.split(/\s+/).filter(t => t.length > 2);

  const out = (Array.isArray(APPS) ? APPS : []).filter(a => {
    const plats = (a.platforms || []).map(p => String(p).toLowerCase());
    const cats = (a.categories || []).map(c => String(c).toLowerCase());
    const hay = (a.name + " " + (a.summary || "") + " " + cats.join(" ")).toLowerCase();
    if (platform && PLATFORMS.includes(platform) && !plats.includes(platform)) return false;
    if (category && !(hay.includes(category) || cats.some(c => c.includes(category)))) return false;
    if (toks.length && !toks.every(t => hay.includes(t) || String(a.name).toLowerCase().includes(t))) return false;
    return !!a.name;
  }).slice(0, limit);

  fireLog(ctx, {
    query: url.searchParams.get("query") || "",
    platform: url.searchParams.get("platform") || "",
    category: url.searchParams.get("category") || "",
    bot, from, limit,
    count: out.length,
    names: out.map(a => a.name),
  });

  return new Response(JSON.stringify(out), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=3600",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

