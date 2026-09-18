// Cloudflare Worker — CALIGO Discord send relay.
// Deploy: Cloudflare dashboard → Workers & Pages → Create → Worker → paste this → Deploy
// → copy the *.workers.dev URL → paste into the app's Gateway → Send path → Send relay → Save relay.
//
// It tries a plain fetch() first; if Discord's edge returns 403 on a write route
// (the 40333 edge block), it retries the SAME request over a raw TLS socket
// (cloudflare:sockets), which carries no proxy fingerprint at all.
// The reply's `via` field ("fetch" | "socket") says which path succeeded —
// the app shows it under the relay field.
//
// `allowHalfOpen: false` exists only because @cloudflare/workers-types declares
// it required (an editor then flags the two-argument connect as TS2345); the
// runtime treats it as optional — safe to ignore either way.

import { connect } from "cloudflare:sockets";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const reply = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
});

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    let p;
    try { p = await req.json(); } catch (e) { return reply({ error: "bad json" }, 400); }
    const url = p.url, method = p.method || "GET", headers = p.headers || {};
    if (!String(url).startsWith("https://discord.com/api/")) return reply({ error: "url not allowed" }, 400);
    const bodyText = p.body == null ? "" : (typeof p.body === "string" ? p.body : JSON.stringify(p.body));
    try {
      const r = await fetch(url, { method: method, headers: headers, body: bodyText || undefined });
      if (r.status !== 403) return reply({ status: r.status, body: await r.text(), via: "fetch" });
    } catch (e) {}
    return reply(await viaSocket(url, method, headers, bodyText));
  },
};

async function viaSocket(url, method, headers, bodyText) {
  const u = new URL(url);
  const lines = [method + " " + u.pathname + u.search + " HTTP/1.1", "Host: " + u.host, "Connection: close"];
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() !== "host") lines.push(k + ": " + headers[k]);
  }
  if (bodyText) lines.push("Content-Length: " + new TextEncoder().encode(bodyText).length);
  const socket = connect({ hostname: u.hostname, port: 443 }, { secureTransport: "on", allowHalfOpen: false });
  const w = socket.writable.getWriter();
  await w.write(new TextEncoder().encode(lines.join("\r\n") + "\r\n\r\n" + bodyText));
  w.releaseLock();
  const raw = await new Response(socket.readable).text();
  const cut = raw.indexOf("\r\n\r\n");
  const head = raw.slice(0, cut);
  let body = raw.slice(cut + 4);
  if (head.toLowerCase().indexOf("transfer-encoding: chunked") >= 0) body = dechunk(body);
  return { status: parseInt(head.split(" ")[1], 10), body: body, via: "socket" };
}

function dechunk(body) {
  let out = "";
  for (;;) {
    const nl = body.indexOf("\r\n");
    if (nl < 0) break;
    const n = parseInt(body.slice(0, nl), 16);
    if (!n) break;
    out += body.slice(nl + 2, nl + 2 + n);
    body = body.slice(nl + 2 + n + 2);
  }
  return out;
}
