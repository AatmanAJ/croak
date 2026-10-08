# Croak

A Discord bot that checks every link, server invite and image posted in a server and removes scams, phishing and NSFW spam. Brand and voice: [brand/BRAND.md](brand/BRAND.md).

## Run it

1. In the [Discord Developer Portal](https://discord.com/developers/applications), turn on **Message Content Intent** (Bot tab).
2. Put your keys in `.env`:
   ```
   DISCORD_TOKEN=...
   OPENAI_API_KEY=...
   DEV_GUILD_ID=...   # optional: your test server's ID, so /croak shows up there instantly
   ```
3. Install and start:
   ```bash
   npm install
   npm start
   ```
   The bot prints its invite link when it starts.
4. In your server, run `/croak setup channel:#mod-log`.

With Docker: `docker compose up -d --build`. The cache and settings are kept in `./data`.

## Commands

All of these need **Manage Messages** (`setup` needs **Manage Server**). Overrides only apply to the server they're made in.

| Command | What it does |
|---|---|
| `/croak setup channel:#x [timeout_minutes]` | Where cases are posted, and how long a croaked member is timed out (default 60, 0 = never). |
| `/croak check link:...` | Shows what Croak would do with a link or invite, with its scores. |
| `/croak allow target:... [whole_site]` | Always allow a link, a whole site, or invites to a server. |
| `/croak block target:... [whole_site]` | Always croak them. |

Each case in the mod log has buttons. A croaked message gets **Not spam**, which allows its links, server or image here from now on and lifts the timeout. A held or flagged message gets **Approve** or **Block**.

## How it decides

Every message from someone who isn't a mod goes through these steps:

1. **Repeats.** The same message in 3 channels within a minute gets every copy deleted and the author timed out. No AI call.
2. **Extraction.** It pulls out links, invites and images. Tenor and Giphy GIFs are skipped by host; other GIF files are checked.
3. **Each item is judged, cheapest check first:**
   - **Trusted sites** (`TRUSTED_DOMAINS` in [src/config.js](src/config.js)) are allowed.
   - **Cache.** Saved verdicts are reused. This server's own overrides come first, then the verdicts shared by every server.
   - **Invites** are looked up and judged by the server they lead to, not the invite code. Discord's own Explicit and Age-Restricted ratings are blocked straight away.
   - **Images** are matched by perceptual hash, so resized or recompressed copies of a blocked image are caught.
   - **Short links** (bit.ly and similar) are expanded first, so the real destination is what gets judged.
   - **The AI** gets anything left over: OpenAI's Decisions API answers three questions (scam, NSFW, spam), each with its own probability. For images, if it refuses the NSFW question, the free moderation endpoint answers instead.
4. **Action, based on the highest score:**
   - **0.9 or above:** delete, time the author out, DM them, and post a case.
   - **0.6 to 0.9:** for a new member (account under 7 days, or joined in the last 24 hours), remove the message until a mod decides. For anyone else, leave it up and flag it.
   - **AI slow or down** (2-second limit): new members are held; everyone else is let through.

Every AI verdict is cached. Approvals expire (links 7 days, images 30), and blocks last 90 days. A mod's Block never expires.

All the numbers live in [src/config.js](src/config.js).

## Scripts

| Script | |
|---|---|
| `npm start` | Run the bot |
| `npm test` | Unit tests (no Discord or OpenAI calls) |
| `npm run try` | Score the Decisions API on `test-set/` and time it |
| `npm run brand` | Rebuild the logo, OG image and other brand assets |
