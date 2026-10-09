# Croak

A Discord bot that checks every link, server invite and image posted in a server, and removes scams, phishing and NSFW spam. Website: https://croakbot.base44.app · Brand and voice: [brand/BRAND.md](brand/BRAND.md).

## Run it

1. In the [Discord Developer Portal](https://discord.com/developers/applications), turn on **Message Content Intent** (Bot tab).
2. Put your keys in `.env` (see `.env.example`):
   ```
   DISCORD_TOKEN=...
   OPENAI_API_KEY=...
   DEV_GUILD_ID=...        # optional: register /croak instantly in one test server
   AI_DAILY_LIMIT=20000    # optional: AI calls per day across all servers (~$1.30)
   HEARTBEAT_URL=...       # optional: pinged every minute, for an uptime monitor
   ```
3. Install and start:
   ```bash
   npm install
   npm start
   ```
   On startup Croak prints two invite links: one with the permissions it needs, and one that also covers the optional features.
4. In your server, run `/croak setup channel:#mod-log`, or press **Create a private #croak-log** on the welcome message.

With Docker: `docker compose up -d --build`. The cache and settings are kept in `./data`.

## Commands

Everything needs **Manage Messages**. Commands that change settings also need **Manage Server**. Allow and block entries only apply to the server they're made in.

| Command | What it does |
|---|---|
| `/croak setup channel [timeout_minutes]` | Sets the mod-log channel and the timeout length. |
| `/croak status` | Checks permissions and role position, and shows every setting and today's usage. |
| `/croak stats [days]` | Shows croaks, holds, overturned decisions, top reasons and top blocked sites. |
| `/croak check link` | Shows what Croak would do with a link or invite, with its scores. |
| `/croak allow / block / unlist target [whole_site]` | Adds or removes an allow or block entry for a link, a whole site, or a server's invites. |
| `/croak lists` | Lists this server's allow and block entries. |
| `/croak sensitivity level` | **Relaxed** croaks at 0.95 and reviews at 0.75. **Standard** croaks at 0.9 and reviews at 0.6. **Strict** croaks at 0.8 and reviews at 0.5. |
| `/croak category name enabled` | Turns the scam, NSFW or spam check on or off. |
| `/croak exempt-channel` / `exempt-role` | Skips a channel (and its threads) or a role. |
| `/croak actions …` | Sets the timeout length, cleanup window, escalation, quarantine role, raid alert role and member DMs. |
| `/croak automod enabled` | Mirrors confident scam domains into a Discord AutoMod rule. |
| `/croak help` | Lists every command. |

Buttons on mod-log cases:
- A croaked message gets **Not spam**.
- A held or flagged message gets **Approve** and **Block**.
- An appeal gets **Accept** and **Keep removed**.

Whatever a mod decides is remembered for that server.

## How it decides

Each message from someone who isn't a mod goes through these steps:

1. **Skip exempt** channels, threads in them, and exempt roles.
2. **Repeats.** The same message in 3 channels within a minute:
   - Every copy is deleted and the author is punished.
   - Its links are blocked in that server for a day.
   - No AI call is made.
3. **Collect** links, invites and images. This includes:
   - forwarded messages
   - link-preview images, fetched through Discord's proxy only
   - edited messages
   - Tenor and Giphy GIFs are skipped by host; other GIF files are still checked.
4. **Judge each item**, cheapest check first:
   - **Trusted sites:** allowed straight away.
   - **The server's own decisions,** then shared verdicts.
   - **Invites:** judged by the server they lead to. Servers Discord rates 18+ are croaked straight away.
   - **Well-known adult sites** and the `.xxx`/`.porn`/`.sex`/`.adult` endings are croaked as NSFW without the AI.
   - **Images:**
     - Fingerprinted (dHash), so near copies of blocked images are caught.
     - QR codes are read, and a Discord login QR is croaked straight away.
   - **Short links:** expanded first, so the real destination is judged.
   - **Look-alike domains** (`dlscord`, `steamcommunlty`, non-Latin letters) always go to at least a review.
   - **The AI:** anything new goes to OpenAI's Decisions API, which answers three questions (scam / NSFW / spam). If it refuses the NSFW question on an image, the moderation endpoint answers instead.
5. **Apply the server's policy:**
   - Its sensitivity setting.
   - Categories the server switched off.
   - Age-restricted channels skip the NSFW check.
6. **Act:**
   - **Croak:** delete, then punish (timeout or quarantine role, or the next escalation step), clean up the author's recent posts, send a DM with an appeal button, and post a case.
   - **Hold or flag:** borderline items from new members are held; from regulars they're flagged and left up. Someone who tries to ping @everyone with a borderline link is croaked.
   - **Raid:** a burst of croaks against new accounts raises an alert and holds new members' links for 10 minutes.

## Guard rails

- **Spending caps.** The AI is limited per day, in total and per server. After 5 failures in a row it pauses for a minute. While the AI is unavailable, new members are held and everyone else goes through.
- **Cross-server blocks.** When mods in 3 different servers block the same item, it's blocked everywhere.
- **Privacy.** Stored message text is wiped after 30 days, and a server's data is deleted when Croak is removed from it.
- **No surprise errors.** Every action checks permissions first and reports what it couldn't do in the mod log.

The numbers live in [src/config.js](src/config.js) and [src/settings.js](src/settings.js).

## Scripts

| Script | Purpose |
|---|---|
| `npm start` | Run the bot |
| `npm test` | 56 unit and pipeline tests (no Discord or OpenAI calls) |
| `npm run try` | Score the Decisions API on `test-set/` and time it |
| `npm run brand` | Rebuild the logo, OG image and other brand assets |

## Layout

| File | Contents |
|---|---|
| `src/index.js` | Discord client and event wiring |
| `src/moderate.js` | The message pipeline and actions |
| `src/judge.js` | Per-item checks, cache, AI, spending guard |
| `src/collect.js`, `src/extract.js`, `src/links.js`, `src/lookalike.js`, `src/qr.js`, `src/hash.js` | Detection |
| `src/punish.js`, `src/interactions.js`, `src/automod.js`, `src/overrides.js` | Actions, buttons, AutoMod, mod decisions |
| `src/commands.js`, `src/embeds.js` | The /croak command and every message Croak posts |
| `src/db.js`, `src/settings.js`, `src/config.js` | Storage, per-server settings, tunables |
| `src/jobs.js`, `src/trackers.js`, `src/repeats.js` | Housekeeping, welcome, in-memory trackers |
