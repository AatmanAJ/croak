# Croak brand

## Name

**Croak.** A frog snaps up flies; Croak snaps up spam. "Croak" is also slang for dying, which is what happens to the scam.

- Write "Croak" in sentences. The wordmark is lowercase: **croak**.
- The verb is part of the brand. A removed message has been *croaked*.

Name check (8 Oct 2026; this is a search, not legal trademark clearance):

- **No clash in moderation:** I found no Discord bot or moderation tool called Croak, on top.gg or the wider web.
- **Nearest clash:** *Croak*, a hand-drawn indie platformer on Steam with its own Discord server. It's a different category, but it will share some search results.
- **Domains:** WHOIS showed croak.gg, croakbot.com, getcroak.com and croakbot.gg as unregistered. Short .gg names are often sold at premium prices, so check the real price before counting on one.

## Lines

| Use | Copy |
|---|---|
| Tagline | Spam croaks here. |
| One-liner (top.gg short description, App Directory) | Catches scam links, NSFW invites and fake giveaways in your Discord before anyone clicks. |
| Proof line | Links, invites and images, checked in 0.2s. |
| Long description | Croak reads every link, server invite and image posted in your server and checks each one in about a fifth of a second. Scams, phishing and NSFW spam are removed; anything it isn't sure about goes to your mods instead. Every verdict is remembered, so a repeat is removed instantly. |

"0.2s" is the 190ms median from the first API test (`npm run try`, from a home connection). Re-measure on the real server before making harder speed claims.

## Personality

The frog has seen every scam twice. It's unimpressed, quick and quiet. It doesn't lecture and it doesn't celebrate; it just eats the fly.

- **Dry, not cutesy.** Short sentences, and one joke at most, only where nobody is in trouble.
- **Plain words.** Say "scam link", not "malicious payload".
- **Confident with numbers.** Show the score and the time.

### Voice by context

| Where | Tone | Example |
|---|---|---|
| Marketing, top.gg, social | Dry, a little smug | "Nitro isn't free. Croaked." |
| Mod-log embeds | Plain and scannable. The frog flavour stops at the word "croaked". | "Croaked: scam link · scam 0.98 · 190ms" / "Held for review: possible NSFW invite · 0.71" |
| The member whose post was removed | Kind and practical, never mocking. Many scam posts come from hacked accounts of real members. | "Your message in #general was removed because Croak flagged a link in it as a scam. If you didn't send it, your account may be compromised: change your password and turn on two-factor authentication." |
| Setup and errors | Direct. Say what to fix. | "I can't delete messages in #general. Give Croak the Manage Messages permission there." |

Don't: open with "🐸 Ribbit!", put frog puns in warnings, or blame the member.

## Colours

| Name | Hex | Use |
|---|---|---|
| Pond | `#0E1F17` | Backgrounds and ink |
| Moss | `#18342A` | Raised surfaces on Pond |
| Frog | `#8FE04E` | Brand colour, the mark, "allowed" |
| Lily | `#F2F7E9` | Text on dark, light backgrounds, the eyes |
| Mist | `#9DB3A6` | Secondary text on dark |
| Tongue | `#FF5C8A` | The action colour: croaked / deleted |
| Amber | `#FFB547` | Held for review |

Text contrast (WCAG ratio):

- **Safe on Pond:** Lily 15.7, Frog 10.5, Amber 9.7, Mist 7.7, Tongue 5.8. All pass AA.
- **On Moss:** Lily 12.3, Mist 6.0.
- **Never as text on light backgrounds:** Frog on Lily is 1.5 and Tongue on Lily is 2.7.

### Discord embed colours

| Verdict | Colour | discord.js |
|---|---|---|
| Croaked (deleted) | Tongue | `0xFF5C8A` |
| Held for review | Amber | `0xFFB547` |
| Approved | Frog | `0x8FE04E` |
| Info | Mist | `0x9DB3A6` |

## Type

- **Bricolage Grotesque.** ExtraBold (800) for the wordmark and headlines, with slightly tight letter spacing. Regular (400) and Bold (700) for body text.
- **JetBrains Mono Bold** for numbers: scores, timings and the CROAKED stamp.

Both are free under the SIL Open Font License and on Google Fonts.

## The mark

A frog head with half-closed lids, pupils looking left. The side-eye is the whole idea: it looks at every link like it already knows.

- **Keep:** the half-closed lids, the pupils looking left, the flat smirk.
- **Don't:** open the eyes wide, add teeth or a big grin, put it in a shield, or add gradients or outlines.
- **Clear space:** one eye-bump's width on every side.
- **Minimum size:** 24px. On white or light backgrounds below 48px, use the one-colour Pond mark.
- **The tongue:** it only appears in illustrations like the OG image, never in the mark itself.

## Files

Every PNG in `png/` has a matching SVG in this folder.

| File | Size | Use |
|---|---|---|
| `png/avatar.png` | 1024×1024 | Bot avatar and app icon in the Discord Developer Portal, top.gg, social profiles |
| `png/avatar-alt.png` | 1024×1024 | Louder green version for promo, or wherever the dark one gets lost |
| `png/discord-banner.png` | 680×240 | Bot profile banner. Discord covers the bottom-left with the avatar, so nothing important is there. |
| `png/og-image.png` | 1200×630 | `og:image` / `twitter:image` for the website and invite page |
| `png/lockup-on-dark.png`, `png/lockup-on-light.png` | 1600 wide | Website header, README, docs |
| `png/wordmark-on-dark.png`, `png/wordmark-on-light.png` | 1200 wide | Where the frog is already shown nearby |
| `png/mark.png` | 1024 wide | The frog alone, transparent background |
| `png/mark-mono-pond.png`, `png/mark-mono-lily.png` | 1024 wide | One colour: stickers, merch, single-colour print |
| `png/favicon-32.png`, `png/favicon-180.png`, `png/favicon-512.png`, `favicon.svg` | | Browser tab, Apple touch icon, app installs |

All of these are drawn by `build.js`. Change a colour or a line of copy there, then run `npm run brand`.
