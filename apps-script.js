// Google Apps Script — CALIGO Discord send relay.
// Deploy: script.google.com → New project → paste this → Deploy → New deployment → Web app
// → "Execute as: Me" → "Who has access: Anyone" → copy the deployment URL
// → paste into the app's Gateway → Send path → Send relay → Save relay.
//
// The simplest and most reliable free option: it runs on Google's own
// infrastructure, so the request to Discord carries none of Perchance's proxy
// fingerprint and clears the 40333 edge block.

function doPost(e) {
  var p = JSON.parse(e.postData.contents);
  if (!String(p.url).startsWith("https://discord.com/api/")) return out({ error: "url not allowed" });
  var opts = { method: p.method || "GET", headers: p.headers || {}, muteHttpExceptions: true };
  if (p.body != null) opts.payload = typeof p.body === "string" ? p.body : JSON.stringify(p.body);
  var r = UrlFetchApp.fetch(p.url, opts);
  return out({ status: r.getResponseCode(), body: r.getContentText(), via: "appsscript" });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Any host with a plain fetch() (Val Town, Deno Deploy, Fly, a VPS) works in
// the same shape: POST {url, method, headers, body} → {status, body}.
