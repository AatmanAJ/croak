# Contributing to Croak

Thanks for helping keep Discord servers free of scams. Bug reports, new scam patterns and pull requests are all welcome.

## Getting set up

1. Node 22 or newer. Run `npm install`, then `npm test`. The tests need no keys and no network.
2. To run Croak for real, make your own bot in the [Discord Developer Portal](https://discord.com/developers/applications), turn on **Message Content Intent**, and copy `.env.example` to `.env`. Set `DEV_GUILD_ID` to a test server so `/croak` shows up there instantly.
3. `npm start`, then invite your bot with the link it prints.

## Making a change

- Keep pull requests small and focused, and add or update a test in `test/` for any behaviour you change. `test/fake-server.js` gives you a fake Discord server to drive the pipeline and the buttons.
- Match the code around you: plain ESM JavaScript, no new dependencies unless they earn their place.
- Anything Croak says in Discord should be plain and specific: say what happened and what to do next. Messages live in `src/embeds.js`.
- If a change needs a new Discord permission, add it to `PERMISSIONS` in `src/health.js`, so the invite link, `/croak status` and the fix-it messages all pick it up.

## Reporting scams Croak misses

Open an issue with the message text (and the image, if there was one), with real usernames removed. Examples of what it wrongly removed are just as useful.

## Security problems

Please don't open a public issue for a way to get around Croak or to abuse it. See [SECURITY.md](SECURITY.md).
