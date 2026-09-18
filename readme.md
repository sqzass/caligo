# CALIGO — handoff note for the docs-site agent

> **You are a local agent with this repo checked out.** The agent that wrote this file runs inside
> the Perchance editor (it edits the generator live). You don't — you work locally on the files.
> This file is both (a) a map of the project and (b) the brief for a **documentation site dedicated
> to CALIGO**, including an explicit list of things to **move out of the generator and onto the site**
> (the deployable relay/worker code is the main one) and **delete from the generator**.
>
> Read `src/README.md` as well — it is the canonical architecture doc, written for an agent editing
> the generator. This file is the docs-site-oriented companion: same project, different job.

---

## 0. TL;DR — what you are being asked to do

1. **Build a docs site for CALIGO** (the Telegram + Discord AI bot manager that lives at
   `https://perchance.org/caligo`). Landing/home page + user documentation + reference pages.
2. **Move the relay ("worker") code to that site and delete it from the generator.** Right now the
   Cloudflare-Worker and Google-Apps-Script relay snippets are *displayed inside the app*
   (`Gateway` tab → `Send path`) as big copy-paste `<pre>` blocks, and also live in
   `src/lib/relay.js`. They are documentation/installation content, not runtime code. The docs site
   should host the deploy guides + copyable snippets; the generator should keep only the relay
   **URL field** and its runtime behaviour and link out to the guide. Exact edit checklist: §6.
3. **Don't break sending while doing it.** §7 lists what must stay.
4. Anything else that is long-form *instructions* rather than *app behaviour* is a candidate for a
   "move to docs, link from app" pass — §6.B lists them; treat those as suggestions and confirm with
   the user before deleting in-app text.

**Fast facts**

| | |
| --- | --- |
| Generator name | `caligo` (user-visible page: `https://perchance.org/caligo`) |
| Runtime origin | `https://<generatorPublicId>.perchance.org/caligo` (iframe; publicId `06457ab612d3bd6e3c2a459ef3c4df31`) |
| State | saved, 3 bots in the author's browser, boots clean |
| Platforms managed | Telegram **and** Discord |
| Build step | **none** — browser-native ES modules, relative imports, no bundler, no npm |
| Entry | `index.html` (all CSS + a pre-paint theme script + the server-plugin script + `<script type="module" src="src/app.js">`) |
| Routes | `#/dashboard`, `#/bot?id=…` (with tabs), `#/analytics`, `#/free`, `#/settings` |
| Skins × layouts | 3 skins (`aero`, `mono`, `terminal`) × 4 shells (`sidebar`, `taskbar`, `chat`, `desktop`), orthogonal |
| AI | Perchance `ai-text-plugin` (+ `text-to-image-plugin`) — free, no API keys |
| Backend | `server-plugin` (coordinator: leases/feed/desired-state) + `kv-plugin` (local) + `upload-plugin` (encrypted sync) |

---

## 1. What CALIGO is (the product story the docs site must tell)

A free, fully client-side manager that gives **Telegram and Discord bots an AI brain** — a rewrite of
the React/Express/Firebase "T-Bot Manager" as a single Perchance generator. The paid Gemini backend
was replaced by Perchance's free `ai-text-plugin`; the Express/Firebase backend by Perchance's free
plugins. No subscriptions, no API keys, no bot-count paywall.

Core honest caveat that everything else hinges on — **make it prominent in the docs**:

- The Perchance server sandbox **cannot make network calls and has no timers**, so the bots only
  *answer while the manager page is open in a browser tab*. Closing the last tab pauses every bot.
  The server's job is coordination + durability (poller leases, activity feed, remembered
  running-intent) so any device that reopens the page resumes in seconds, and no two devices ever
  fight over the same Telegram `getUpdates` loop (no 409s).
- Tokens live only in that browser (kv-plugin) and in the user's **encrypted** sync file. The shared
  coordinator server never receives tokens, and is never even told the real bot ids (it sees
  hash-derived scoped ids).
- Telegram/Discord REST calls from the page go through Perchance's CORS proxy, which does see the
  request (URL/token/body). The Discord **gateway** WebSocket is direct TLS to Discord and is not
  proxied. AI calls go to Perchance's plugins.
- The free AI plugin shows a small ad for non-logged-in visitors.

Two per-platform shapes:

- **Telegram** — inbound is `getUpdates` long-polling via `superFetch`; rich feature set (groups +
  moderation, inline mode, Mini Apps, per-language profile, multi-device leases).
- **Discord** — inbound is a **real gateway WebSocket** opened from the tab (`engine/discord.js`);
  outbound REST has a platform quirk (see §1.1) that requires a self-hosted relay; slash commands
  are supported and join (never replace) the text/@mention reply routes.

### 1.1 The two Discord stories the docs must explain properly

**(a) The 40333 / relay problem.** Through Perchance's proxy, Discord's edge refuses a request whose
`Authorization` header is the canonical `Bot <token>` **and** which is a write to `/channels/*` or
`/guilds/*` — it answers `403 {"message":"internal network error","code":40333}`. Every other
spelling clears the edge but is rejected by Discord's own auth parser (`401`). So **Discord sends
require a relay you host** (reads, identity, the gateway socket and slash-command registration are
all fine without one). The measured table and the full analysis are in `src/README.md` §"Outbound:
the 40333 problem, and the relay" — reuse that material for the docs page, rewritten for users.
- Relay contract: the app POSTs `{url, method, headers, body}` to the user's relay URL and expects
  `{status, body}` back. The relay must accept only `https://discord.com/api/` URLs.
- Recommended hosts: **Cloudflare Worker** (works; falls back to a raw TLS socket via
  `cloudflare:sockets` and reports `via: "fetch" | "socket"`), **Google Apps Script** (most reliable
  free option), or any plain `fetch()` host (Val Town, Deno Deploy, Fly, a VPS).
- This is the code to move — see §6.

**(b) Slash (application) commands.** `engine/slash.js` builds the command set (AI command,
`/imagine`, `/forget`, plus one per user-defined bot command), `dcSyncCommands` publishes it
(`PUT /applications/{appId}/commands`, plus instant per-guild copies), and invocations arrive as
`INTERACTION_CREATE` and are answered through an "interaction sink" in `net.js`. **Registration
needs no relay** (`/applications/*` writes are not edge-blocked) but **answering an invocation does**
(`/interactions/*/callback` and the interaction webhook both return `400 code 50067` through the
proxy); without a relay the sink degrades to channel mode so the reply still arrives. Scope is
"Both" (`integration_types:[0,1]`, `contexts:[0,1,2]`) so commands can be added to a user's account
(Developer Portal → Installation → **User Install** required, else Discord `50035`).

---

## 2. Repo map (every file, one line)

```
main.pjs                 pjs root: $meta, the 6 plugin imports, botHash(). Tiny; ships.
index.html               body-only HTML. Lines 1..~3222 = ALL CSS. Then: pre-paint theme
                         script (~3224), the server-plugin coordinator script (~3242-3551),
                         boot loader + #app/#modalRoot/#toastRoot markup, a pointer-move tilt
                         script, and <script type="module" src="src/app.js">
src/README.md            THE architecture doc (written for the generator-side agent). Read it.
src/app.js               entry: imports everything, fills the `ui` bridge, binds global events,
                         boot(), window.__tbot test surface. ~110 lines.
src/state.js             S (global state) + PLATFORMS + all default*Config() + normalizeBot()
                         + persona resolve/rules + composeInstruction + stealth helpers.
src/store.js             KV (kv-plugin namespaces) + Vault (per-browser manager id) +
                         SyncCrypto (AES-GCM/PBKDF2) + syncPush/syncPull. ~235 lines.
src/net.js               tgApi() + superFetch helpers + the whole Discord REST layer
                         (dcRequest, DC_AUTH spellings, dcCalibrate, relay helpers,
                         dcAppId/dcSyncCommands/dcClearCommands, the interaction sink,
                         discordApi Telegram-shaped surface). ~677 lines — read this one.
src/lib/util.js          esc/fmtFull/fmtRel/sleep helpers + DOCS_URL (the single docs-site link; §6.A).
src/lib/icons.js         inline SVG icon set (ic("name", size)).
src/lib/dom.js           el(id), toast(msg, kind).
src/lib/hooks.js         the `ui` bridge — how engine/store call back into views without importing.
src/engine/server.js     Server (coordinator client: tag/scope/leases/feed/desired), Poller
                         (manager tick + per-bot loop, Telegram poll or Discord gateway),
                         Ambient (keep-alive tone), addLog/logRowHTML.
src/engine/updates.js    handleUpdate → routeUpdate (the inbound router), inline query handler,
                         membership handlers, Trash, textWithEntities, botShouldSee.
src/engine/ai.js         prompt builder + time-aware conversation memory, aiRespond/aiRespondOnce
                         (streaming, tools, vision, typing sim, stealth hold), warmupAI.
src/engine/stealth.js    typing simulation, Stats (response-time learning), human chunks/typos.
src/engine/tools.js      the tool registry (web search, wiki, weather, calculator, read page,
                         translate, unit convert, time) + the `[[tool: {…}]]` call protocol.
src/engine/imagine.js    image generation pipeline: generateImages, hostImage, AI `[[image: …]]`
                         tool, /imagine handler, metadata text.
src/engine/scripts.js    runScript (AsyncFunction) + buildLib (telegram/discord/openai/gemini/
                         huggingface/github/gmail helpers).
src/engine/groups.js     GroupStore + groupPerms + groupCommand (Telegram moderation commands).
src/engine/discord.js    the gateway client (session/_connect/_dispatch), handleDiscordMessage,
                         handleDiscordInteraction, INTERACTION_CREATE, _autoSlash.
src/engine/slash.js      buildSlashCommands, sync/clear, install links, arg mapping.
src/views/shell.js       sidebar/mobile nav, skins+layouts registry (LAYOUTS/THEME_OPTIONS),
                         Clock, taskbar, the `chat` layout's conversation panes,
                         parseHash/go/renderRoute/afterRoute.
src/views/bots.js        viewBotDetail (tab list per platform), tabSettings (TG + Discord),
                         tabInline, INLINE_LANGS, capCard.
src/views/bot-ai.js      tabAI / tabAutomation / tabChat / tabScripting / tabLogs / tabMore.
src/views/bot-discord.js tabDiscord — **the Gateway tab, incl. the relay UI (§6)**.
src/views/bot-groups.js  tabMiniApps (incl. buildMiniAppHTML) + tabGroups + group/member lists.
src/views/bot-personas.js tabPersonas (per-server persona library + bindings).
src/views/stealth.js     tabStealth + STEALTH_PRESETS + readStealthForm + form rows.
src/views/dashboard.js   viewDashboard, viewAnalytics (+ charts), **viewFree** (the "100% Free"
                         page incl. the keep-your-bots-online guide — see §6.B).
src/views/settings.js    appearanceHTML, viewSettings, modal open/close, add/delete-bot modals.
src/views/layout-desktop.js the `desktop` shell (wallpaper, dock, frosted window).
src/views/console.js     chat bubbles, renderChat, renderLogs, applyLogFilter.
src/views/files.js       knowledge-base file text extraction + chat image input.
src/views/actions.js     ACTIONS barrel (spreads the 11 concern-grouped maps below).
src/views/actions-{core,bots,ai,personas,stealth,commands,chat,integrations,social,settings,discord}.js
                         delegated click handlers (data-act → method). Add handlers here.
imports/                 READ-ONLY reference copies of the 6 imported Perchance plugins
                         (ai-text, kv, server, super-fetch, text-to-image, upload). Do not edit.
scratch/                 Ephemeral (screenshots, downloaded generator sources). Dies with a session.
```

**Module graph / rules** (keep them true if you touch code):
`lib/` has no deps → `state.js`, `store.js`, `net.js` → `engine/*` → `views/*`. Imports are one-way;
`engine/discord.js → lib/util, state, net, engine/slash` with no cycle. Engine and store talk to the
UI only through the `ui` bridge (`src/lib/hooks.js`), never by importing a view.

---

## 3. Architecture notes worth documenting ("How it works" pages)

- **Perchance layer.** `main.pjs` declares `$meta` (title/description/image/tags, minimal header),
  imports six plugins, and `botHash()` — the tiny stable hash used to derive every id the coordinator
  server sees. Top-level names become globals on `root`; app code always uses `root.generateText`,
  `root.kv.*`, `root.superFetch`, `root.uploadPlugin`, `root.createServerSocket`, `root.generateImage`.
  The engine renders the whole template first, then runs `index.html`'s scripts in order.
- **The coordinator (`<script type="text/x-server-plugin">` in `index.html`, ~lines 3242-3551).**
  A durable, tagged, per-vault coordination room shared by *everyone* who opens the generator:
  - each browser mints a random 128-bit **vault id** (Settings → Manager ID), never sent to the
    server; the client derives a 16-hex **feed tag** and a 16-hex **scoped bot id** per bot;
  - per-connection subscription pinned to `feed:<tag>`; tagged ring buffer (512×160 B) with a
    per-vault cap and a 25/s push rate limit; a durable desired-running-state table (LRU-evicted);
  - ephemeral **poller leases** (TTL 120 s, re-granted by client heartbeats, freed on socket close);
  - RPCs `register`/`heartbeat`/`release`/`setDesired`; feed events pushed as `FEED|<json>`.
  - **Platform constraint to state plainly:** the sandbox has no network access → it cannot poll
    Telegram or call the AI. Coordination only.
  - Known ceiling: one pub/sub topic per vault, 4,096 topics per generator.
- **Persistence.** kv-plugin namespaces: `tbotMeta` (profile/settings/sync/vault), `tbotBots`,
  `tbotOffsets` (getUpdates offset), `tbotLogs`, `tbotChats` (per `botId:chatId` conversation),
  `tbotStats`, `tbotGroups`. Cloud sync = an upload-plugin *editable* file with a long caller-chosen
  name, **encrypted client-side** (AES-256-GCM, PBKDF2-SHA256 200k) under a user passphrase; legacy
  plaintext files still readable and re-encrypted on next push.
- **Theming.** Two orthogonal axes in `S.settings` + a `localStorage` mirror (`caligo.theme`) read
  by the pre-paint script so there is no flash: `<html data-theme>` = skin, `<html data-layout>` =
  shell. A skin never appears inside a layout selector and vice-versa. `views/shell.js` registers
  shells in `LAYOUTS`; `views/layout-desktop.js` is the fourth. Optional shell members:
  `renderSidebar()`, `wrapMain()`, `frameMain()`, `taskbar: true`.
- **Security model** (document it, don't bury it): see §1; plus custom scripts run via `AsyncFunction`
  in the page with API keys **withheld unless** the per-bot "Expose API keys to scripts" toggle is on;
  treat AI-written script code as untrusted.

---

## 4. Feature inventory = the docs site's table of contents

Group these into sections; each bullet below notes where the real implementation/copy lives so you
can extract accurate text instead of inventing it.

**Getting started**
- Create a bot (Telegram `@BotFather` / Discord Developer Portal), paste the token, go LIVE.
- The "only while a tab is open" reality, keep-alive tone, keep-the-device-awake guidance,
  encrypted multi-device sync. Source: `views/dashboard.js` `viewFree()` (§6.B — candidate to move).

**Telegram** (`views/bots.js`, `bot-groups.js`, `state.js` defaults)
- Settings tab: token, capabilities refresh, per-language name/description.
- AI replies: instruction, model knobs, vision toggle, image generation, tools.
- Stealth/humanizer: typing simulation, response-time learning, active hours, chunking/typos.
- Automation: webhook clearing, running intent, command sync.
- Groups: learned while LIVE (`tbotGroups`), welcome/goodbye, AI-in-groups toggle, admin moderation
  commands (`/id /admins /kick /ban /unban /mute /unmute /settitle /setdesc /leave`), per-group
  manage panel.
- Inline mode: master switch, answering engine (`ai`/`templates`/`both`), result templates with
  `{query}`, caching, per-user AI history, `@BotFather /setinline` requirement, `INLINE_LANGS`.
- Mini Apps: starter single-file HTML builder or AI-written page, register URLs, set live menu button
  (`setChatMenuButton`).
- Personas: per-DM / per-server / per-chat persona bindings, SFW vs adult-allowed rule line, AI
  drafting of a persona instruction.
- Scripting: per-bot JS, `lib.telegram/…`, keyword auto-runs, secret exposure toggle.
- Logs, live chat tab, analytics.

**Discord** (`views/bot-discord.js`, `bot-ai.js` Automation tab, `engine/discord.js`, `slash.js`, `net.js`)
- Gateway tab: live connection state, reply rules (DMs / pings / AI-in-guilds / ignore bots), intents
  (`37377`; auto-retry `4609` without Message Content, fatal-close handling), the send path (40333
  story + test + spelling calibration + relay field), the Slash commands card, the Developer Portal
  checklist.
- Relaying outbound: the deploy guides + code → **docs site** (§6). 
- Slash commands: registration, scope/Installation→User Install, `Add to My Apps` link, answering,
  ephemeral option, clear, stealth interaction behaviour.
- Deliberately unsupported on Discord: guild moderation, inline mode, Mini Apps, multi-device leases
  for the gateway; no webhooks for normal sending; no userbotting (ToS).

**Cross-cutting**
- AI engine: free model, streaming, prefix-cache-friendly prompt design, memory with timestamps and
  "time gap" seams, personas, tools (`[[tool: …]]`), image tool (`[[image: …]]`), vision, silent
  pre-warm.
- Image generation: `/imagine`, AI-invoked images, seeds/resolution metadata, baked-in negative prompt.
- Themes & layouts: 3 skins × 4 shells, motion toggle, per-option screenshots.
- Privacy & security page (tokens, proxies, encryption, what the coordinator sees).
- FAQ / troubleshooting (409 conflicts, privileges, why a bot went offline, relay `via: socket`,
  50067, 50035, ad on the free AI).
- Reference: the tool list, the moderation command list, kv namespaces, the coordinator protocol
  (from `src/README.md`), `$meta`.

---

## 5. Docs-site spec (recommended)

- **Audience:** end users who just want a bot that answers with AI, plus self-hosters of the relay.
  Keep the "How it works / architecture" material in a separate, clearly-marked advanced section.
- **Stack:** anything static and cheap. A good default is **VitePress** or **Astro** (Markdown
  content, good search, dark/light); **plain hand-written HTML/CSS with no build** is also perfectly
  viable and matches the generator's own zero-build philosophy. Do **not** add a build step to the
  generator itself.
- **Repo placement:** a new top-level `docs/` (or `site/`) folder. Only `main.pjs`, `index.html` and
  `src/` ship with the generator, so a `docs/` folder here is invisible to it and safe. Host on
  GitHub Pages / Cloudflare Pages / Netlify.
- **Design:** reuse CALIGO's design tokens and feel. The five skins/layouts are the app, not the site,
  but the site should echo the aero/glass + mono aesthetic. Useful sources: the `:root`/`[data-theme]`
  token block at the top of `index.html` (colours, radii, shadows), `.card`/`.chip`/`.btn`/`.notice`
  classes, and the icon set in `src/lib/icons.js`.
- **Assets:** screenshots can be captured from the live app (the previous agent has some under
  `scratch/shots/`, but `scratch/` is ephemeral — regenerate locally). The existing `$meta.image`
  (`https://user.uploads.dev/file/031caa498afbf2bb90887d311611de52.webp`) can be the social/hero image.
- **Linking from the generator:** links must use the **top-level page** URL `https://perchance.org/caligo`
  (never the `*.perchance.org` subdomain, and never `location.href`). Forks get a different name, so
  put the docs URL in one place (it now lives as `DOCS_URL` in `src/lib/util.js`)
  rather than hardcoding it in several views. In-app, replace the relay code block with:
  `Full deploy guide: <a href="${DOCS_URL}/discord/relay" target="_blank">…</a>`.

---

## 6. MOVE TO THE DOCS SITE / DELETE FROM THE GENERATOR

### 6.A The relay ("worker website") code — ✅ already removed from the generator

The Cloudflare Worker + Google Apps Script relay snippets were documentation, not runtime code.
**They have already been taken out of the generator** (by the Perchance-side agent), and the relay
**field and behaviour were kept** (§7). Both snippets are preserved verbatim in **Appendix A** at the
bottom of this file — that is the copy to move into the docs site (as real copyable/downloadable
files + a deploy page). Do not put them back into the generator.

The table below is the record of what was changed, so you can review/diff it:

| # | File / symbol | Change (applied) |
| --- | --- | --- |
| 1 | `src/lib/relay.js` — `export const RELAY_CF`, `export const RELAY_GAS` | **Deleted** — content preserved verbatim in Appendix A. Its only importer was `bot-discord.js`. |
| 2 | `src/views/bot-discord.js:6` | Delete `import { RELAY_CF, RELAY_GAS } from '../lib/relay.js';` |
| 3 | `src/views/bot-discord.js` (Send path card) | The `<details>` "Show the relay code …" block (both `<pre class="relay-code">` elements + the four copy/open buttons) is gone, replaced by a button that links to `${DOCS_URL}/discord/relay`. |
| 4 | `src/views/bot-discord.js` | The **Send relay (optional)** hint no longer says "the code below …"; it links to the same docs page. |
| 5 | `src/views/actions-discord.js` | Removed `openGas()` and `copyDiscordCode(arg)`; also reworded the "so sends need the relay below" diagnostic line. (`openDiscordPortal` / `openDiscordInstall` / `copySlashInstall` kept.) |
| 6 | `index.html` | Removed the `.relay-code` CSS rule (`.mono` kept). |
| 6b | `src/lib/util.js` | Added `export const DOCS_URL = "https://example.com/caligo-docs";` — **the one place to set the docs URL** (§10). |
| 6c | `src/net.js` | The comment above `DC_API` updated to point at the docs site instead of the deleted file. |
| 7 | `src/README.md:~60-146` — §"The relay (Cloudflare Workers included)" | Trim the two fenced code blocks and the deploy walkthrough prose down to a short pointer at the docs site (one canonical copy of the code). **Keep** the 40333 analysis before it and the `via: "fetch" \| "socket"` / relay-contract explanation — that's architecture, not a how-to. |
| 8 | everywhere | `grep -rn "RELAY_CF\|RELAY_GAS\|relayCfCode\|relayGasCode\|copyDiscordCode\|openGas\|relay-code" .` → expect **zero** hits after the above. |

Notes:
- The snippets are ~72 lines (Worker, includes the `cloudflare:sockets` fallback and HTTP/1.1
  de-chunking) and ~12 lines (Apps Script). Copy them **from the file**, don't retype.
- Two details to preserve in the docs version of the Worker guide: the `via: "fetch" | "socket"`
  reply field (the app shows it under the relay field) and the `allowHalfOpen: false` note
  (a `@cloudflare/workers-types` TS2345 quirk, harmless to ignore).
- Optional but recommended on the docs site: a "Test your relay" snippet/curl example and the exact
  contract (`POST` one `{url, method, headers, body}` → `{status, body}`, only `discord.com/api/`).
- Once moved, the docs site becomes the single source of truth. That removes the "keep the app,
  `src/lib/relay.js` and `src/README.md` in sync" maintenance warning in the README — delete that
  sentence too.

### 6.B Other long-form instructions — candidates to move (confirm with the user first)

These are *guidance text* that a docs page can own, with the in-app version shrinking to a summary +
link. Do **not** delete these without checking — some are important in-context:

| Where | Content | Suggestion |
| --- | --- | --- |
| `src/views/dashboard.js` → `viewFree()` | "Keep your bots online while you're away" 4-step guide; "Why it's free" explainer | Strong candidate: docs "Uptime & hosting" + "Why free" pages; keep a one-line hint in-app with a link. |
| `src/views/bot-discord.js` (~185-193) | The long 40333 explainer notice in the Send path card | Docs "Discord sending & the relay" page; in-app keeps a 2-line summary + link. |
| `src/views/bot-discord.js` (~239-262) | Developer Portal checklist (6 steps) | Docs "Discord setup" page; the in-app checklist is genuinely useful in place — probably keep both, link for detail. |
| `src/views/bots.js` (~100, ~145) + other token hints | Token/privacy/hint copy | Keep in-app (security-relevant context); mirror on a docs "Privacy" page. |
| `src/views/bot-groups.js:97` | "host the file and paste its https URL" Mini-App hint | Short; keep in-app, link to a docs Mini-Apps page. |

---

## 7. Do NOT remove (keeps Discord sending working)

After §6.A, the following must remain exactly as-is:

- `bot.discordConfig.relay` — the per-bot relay URL (the input `#dcRelay` + **Save relay** button,
  `saveDiscordRelay` in `actions-discord.js`).
- `net.js`: `dcRelayUrl`, `dcViaRelay`, `dcRequest` (relay-preferred, spelling walk, `DC_AUTH`),
  `dcCalibrate` (the "Test send path" flow), `dcWebhookRequest` (50067 → `needsRelay`), and the
  `dcRuntime.via` display.
- The interaction sink (`dcInteractionSink`/`dcInteractionSinkFor`/`dcFinishInteraction`/`dcIx`) and
  `discordApi`'s sink routing.
- The `Slash commands` card and its handlers (`saveSlashConfig`, `syncSlash`, `clearSlash`,
  `copySlashInstall`, `openDiscordInstall`), plus `engine/slash.js` and the `dcAppId`/`dcSyncCommands`/
  `dcClearCommands` trio.
- The coordinator `<script type="text/x-server-plugin">` in `index.html` — **never** cut this; the
  whole app depends on it. (If "worker website" was ever read as "the coordinator", that's a
  misunderstanding: it is runtime code and stays.)
- All of `main.pjs`'s plugin imports.

---

## 8. Perchance constraints a local agent must know

- **Only `main.pjs`, `index.html` and `src/` are the generator.** Everything else in the repo
  (including `docs/`, `scratch/`, this file) is not shipped and not visible to the running generator.
- `src/` is public and quota-limited (2 GB, 100 MB/file, 10k files) — keep the docs site **out** of it.
- **No build step anywhere.** Browser-native ES modules, relative imports. `index.html` loads only
  `src/app.js`. Don't introduce npm/bundling into the generator; `docs/` is free to use whatever.
- Plugins must be used through `root.*` (`root.kv`, `root.generateText`, …); only the top-level import
  assignment in `main.pjs` is bare. Bare globals work only inside inline classic `<script>`s in
  `index.html` (not in modules, not in `src/`).
- `window.generatorName` gives the name (changeable); `https://perchance.org/<name>` is the public URL.
- Cross-origin `new Worker("https://…")` throws — wrap in a Blob URL if you ever need one (you
  shouldn't, on a static docs site).
- The editor-side agent applies file edits to the live preview with `page_refresh`; you don't need any
  of that locally, but it explains why `src/README.md` talks about it.

---

## 9. Verification notes

- **§6.A is already applied** — there is nothing left to do for the removal beyond building the docs
  page from Appendix A. Confirm with
  `grep -rnE "RELAY_CF|RELAY_GAS|relayCfCode|relayGasCode|copyDiscordCode|openGas|relay-code|lib/relay" .` —
  expect hits **only** in this file, never in `main.pjs` / `index.html` / the rest of `src/`.
- `src/README.md` mentions a module smoke check at `.misc/check-modules.mjs`
  (`node --experimental-default-type=module .misc/check-modules.mjs`) — **that file is not present in
  this workspace.** If it exists in your local checkout, run it; otherwise verify by loading the
  generator (a Discord bot's **Gateway** tab renders, the relay field + **Save relay** work, and the
  deploy-guide button opens `${DOCS_URL}/discord/relay`).
- There are no tests besides that; the app is verified by running it and exercising the route(s) you
  touched.

---

## 10. Open decisions (ask the user)

1. **Where does the docs site live** — a `docs/` folder in this repo (recommended) or a separate
   repo, and what's the final URL? **`DOCS_URL` in `src/lib/util.js` is currently the placeholder
   `https://example.com/caligo-docs`** — set it to the real URL (the app links to
   `${DOCS_URL}/discord/relay`).
2. **Stack** — VitePress/Astro vs. hand-written static HTML. (The generator is zero-build; a
   matching plain-HTML site is very much in keeping.)
3. **§6.B scope** — which in-app guide texts move, and how aggressively the in-app versions shrink.
4. **Branding** — is the docs site "CALIGO docs" only, or also the project landing page (hero,
   screenshots, feature grid, live-app link)? The material for both exists in `viewFree()` /
   `$meta`.

---

## Appendix A — the relay snippets (canonical copies)

These were removed from the generator (`src/lib/relay.js` is deleted). Move them into the docs site as
real files — suggested paths `docs/public/deploy/cloudflare-worker.js` and
`docs/public/deploy/apps-script.js` — and write the deploy page around them (the app links to
`${DOCS_URL}/discord/relay`). Verbatim, with the template-literal escaping of the old source undone.

### A.1 Cloudflare Worker — `cloudflare-worker.js`

Deploy: Cloudflare dashboard → **Workers & Pages → Create → Worker** → paste over the template →
**Deploy** → copy the `*.workers.dev` URL into the app's **Gateway → Send path → Send relay** field →
**Save relay**. It tries an ordinary `fetch()` first; if Discord's edge refuses that with 403 it
repeats the same request over a raw TLS socket (`cloudflare:sockets`), which carries no proxy
fingerprint at all. The reply's `via` field (`"fetch"` or `"socket"`) says which path did the work, and
the app shows it under the relay field. `allowHalfOpen: false` is only there because
`@cloudflare/workers-types` declares it required (an editor then flags the two-argument form as
TS2345) — it is optional at runtime.

```js
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
```

### A.2 Google Apps Script — `apps-script.js`

Deploy: script.google.com → **New project** → paste → **Deploy → New deployment → Web app**,
"Execute as: Me", "Who has access: Anyone" → copy the deployment URL into the relay field. It runs on
Google's own infrastructure, so nothing about the request looks like a proxy, and it costs nothing.
This is the most reliable free option.

```js
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
```

Any host with a plain `fetch()` (Val Town, Deno Deploy, Fly, a VPS) works in the same shape.

### A.3 The relay contract (for the docs page)

- The app `POST`s a JSON body `{url, method, headers, body}` to the relay URL and expects
  `{status, body}` back (optionally `via`, which the app displays next to the relay field).
- A relay must refuse anything that is not a `https://discord.com/api/` URL — that is what stops it
  being usable as a general-purpose open proxy.
- The relay sees exactly what the browser was already sending Discord (the request URL, the
  `Authorization: Bot <token>` header, the body). It adds no secret and stores nothing.
- Quick test: `curl -X POST <relay-url> -H 'content-type: application/json' -d '{"url":"https://discord.com/api/v10/gateway","method":"GET"}'`
  → `{"status":200,...}`.
