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

### On a server

Croak keeps one connection to Discord open all the time, so it needs an always-on machine rather than serverless hosting. Anything with 1 GB of RAM is plenty: it uses about 300 MB.

The reference setup is Ubuntu 24.04 on ARM with Node 24. Croak runs as a systemd service (`Restart=always`), and a cron job takes a daily copy of the database (`VACUUM INTO`), keeping the last 7.

To ship changes, set `CROAK_HOST=ubuntu@<server-ip>` in `.env` and run `scripts/deploy.sh`. It copies the code and `.env` (never `data/`), reinstalls packages and restarts the bot. Run only one copy of Croak per bot token, otherwise every message gets handled twice.

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
| `/croak settings` | Every main setting on one screen: mod-log channel, sensitivity, timeout, escalation, category and DM toggles. |
| `/croak member user` | A member's cases, strikes, watch and trust status, with buttons to watch, trust, delete their last 30 minutes, time out or ban. |
| `/croak case number` | One case: what Croak saw, the outcome, its history, and a link to the log entry. |
| `/croak lockdown action [minutes] [slowmode_seconds]` | Slowmode on every text channel and invites paused, for a set time. Ending it puts each channel back exactly as it was, even after a restart. |
| `/croak message [note] [clear]` | Adds the mods' own line to the DM members get when a message is removed. |
| `/croak digest schedule` | A weekly summary in the mod log. |
| `/croak test` | Posts a sample case in the mod log. |
| `/croak help` | Lists every command. |

### Right-click tools (Apps menu)

| Tool | Who | What it does |
|---|---|---|
| **Report to mods** (message) | Everyone | Sends the message to the mod log with a reason, as a case with **Croak it** and **Dismiss**. One report a minute per person. |
| **Croak this message** (message) | Mods | Deletes it, punishes like a normal croak, blocks its links and images in this server, and opens a case. |
| **Check with Croak** (message) | Mods | Shows the scores for every link, invite and image in it, without acting. |
| **Croak: member** (user) | Mods | Opens the member panel. |

### Cases in the mod log

- A croaked message gets **Not spam** (which reposts it under their name, pings off).
- A held or flagged message gets **Approve** and **Block**; a flagged one also gets **Jump to message**.
- Every case has a **More actions** menu: message the member, add a note, their history, repost, block the whole site, watch for 7 days, time out, remove timeout, kick, ban. Each action is added to the case's **History**.

### Appeals

The DM a member gets has a **This was a mistake** button. Their appeal is posted under the case with **Accept**, **Keep it removed** and **Reply…**. Replying sends your message to the member as a DM with a **Reply to the mods** button, so it becomes a conversation (up to 6 messages each way per case). Every message is posted in the mod log.

### Watch and trust

A **watched** member (7 days) has every link and image held for review, even ones that look fine. A **trusted** member is never checked. Both are set from the member panel or a case's menu.

Whatever a mod decides is remembered for that server.

## How it decides

Each message from someone who isn't a mod goes through these steps:

1. **Skip exempt** channels, threads in them, and exempt roles.
2. **Repeats.** The same message in 3 channels within a minute:
   - Every copy is deleted and the author is punished.
   - Its links are blocked in that server for a day.
   - No AI call is made.
3. **Collect** links (with or without `https://`, including defanged ones like `site[.]com`), invites and images. This includes:
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
| `src/punish.js`, `src/automod.js`, `src/overrides.js` | Punishment, AutoMod, mod decisions |
| `src/interactions.js` | Routes every button, menu, form and right-click to the files below |
| `src/case-actions.js`, `src/appeals.js`, `src/member-panel.js`, `src/reports.js` | Case buttons and menu, appeal conversations, the member panel, right-click tools |
| `src/settings-panel.js`, `src/lockdown.js`, `src/digest.js`, `src/toolkit.js` | /croak settings, lockdown, the weekly digest, shared helpers |
| `src/commands.js`, `src/embeds.js` | The /croak command and every message Croak posts |
| `src/db.js`, `src/settings.js`, `src/config.js` | Storage, per-server settings, tunables |
| `src/jobs.js`, `src/trackers.js`, `src/repeats.js` | Housekeeping, welcome, in-memory trackers |
