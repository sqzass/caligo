import APPS from "../../data/apps.json";

const PLATFORMS = ["android", "ios", "windows", "macos", "linux"];

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("query") || "").toLowerCase();
  const platform = (url.searchParams.get("platform") || "").toLowerCase();
  const category = (url.searchParams.get("category") || "").toLowerCase();
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