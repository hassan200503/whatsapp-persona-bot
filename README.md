# WhatsApp Persona Bot

Auto-replies to your WhatsApp messages in your own voice while you're offline,
learns your writing style over time from messages you actually send, and can
pitch your freelance skills to leads.

## Read this first — important, honest limitations

1. **This uses WhatsApp Web's underlying protocol (via the Baileys library),
   not WhatsApp's official Business API.** That's what makes it possible to
   run on your *own* personal number and see your real chats — but it's
   against WhatsApp's Terms of Service, and WhatsApp does detect and ban
   numbers it identifies as automated. Real risk factors: sending too fast,
   replying to everyone instantly with no delay, or high message volume. This
   bot adds random human-like delays and per-chat rate caps to reduce (not
   eliminate) that risk. Use a number you're comfortable putting at risk —
   many people pair a secondary/business SIM rather than their main personal
   number for exactly this reason.
2. **It only has to run on a computer that stays on.** If you close the
   laptop or the process stops, it stops replying — WhatsApp itself doesn't
   run it for you. Options: leave it running on a machine at home, or deploy
   it to a small always-on server later.
3. **It learns from messages going forward, not your old chat history.**
   Baileys connects like a new linked device — it doesn't retroactively pull
   years of past conversations. Every message *you* send after this is
   running gets logged as a style sample (see `data/style-log.jsonl`), so the
   more you use WhatsApp normally with this running, the better it sounds
   like you. To jump-start it, paste some real past messages into the
   "Example messages" section of `data/persona-seed.md` right now.
4. **It never sends on your behalf without limits.** It won't quote prices,
   commit to deadlines, or pretend to be finalizing a deal — it's instructed
   to always say "I'll follow up personally" for anything that matters, and
   you review everything it sent in `logs/auto-replies.log`.

## Setup (one-time)

### 1. Install Node.js 20+
Download from https://nodejs.org (LTS version) if you don't have it. Check with:
```
node -v
```

### 2. Install dependencies
From inside this folder:
```
npm install
```

### 3. Configure your settings
```
cp .env.example .env
```
Then open `.env` and fill in:
- `ANTHROPIC_API_KEY` — get one at https://console.anthropic.com/ (this is
  the "brain" writing your replies; it costs a small amount per message, pay-as-you-go)
- Review `AWAY_MODE`, `IGNORE_NUMBERS`, and the reply-delay/rate settings

### 4. Fill in your persona
Open `data/persona-seed.md` and fill in the bracketed sections — your name,
tone, skills, rates policy, and ideally 5-10 real messages you've actually
sent. This is the single biggest thing that makes replies sound like you
instead of a generic bot. You can edit this file any time, even while the
bot is running — changes apply to the next reply immediately.

### 5. Run it and pair with WhatsApp
```
npm start
```
A QR code will print in your terminal, and also save as `latest-qr.png` in
this folder. On your phone: **WhatsApp → Settings → Linked Devices → Link a
Device**, then scan it. Once connected, you'll see "Connected to WhatsApp.
Bot is live." in the terminal.

Your session is saved in the `auth/` folder, so you won't need to re-scan
every time you restart — only if you get logged out or run
`npm run reset-session`.

## Using it day to day

- **Turn auto-replies on/off**: `.env` has `AWAY_MODE=true/false`, but you
  don't need to touch a file or restart — just send the message
  `/awaytoggle` (or whatever you set `TOGGLE_KEYWORD` to) to any chat from
  your phone, and it flips for the rest of that run. Send it again to flip back.
- **Check what it said while you were out**: `logs/auto-replies.log` has a
  plain-English transcript of every auto-reply, with the incoming message
  it was responding to.
- **It stays quiet whenever you personally reply** to a chat — as soon as
  you send a real message yourself, the bot treats that conversation as
  "you've got it" and won't jump in again until the next new incoming message.
- **Protect specific people**: add their phone numbers (digits only, with
  country code, e.g. `2547XXXXXXXX`) to `IGNORE_NUMBERS` in `.env` — the bot
  will never auto-reply to them (good for close family/friends).
- **Groups are ignored by default** (`REPLY_IN_GROUPS=false`) — leave this
  off unless you specifically want it replying in group chats too.

## Keeping it running long-term

This process needs to keep running to keep working. This repo is set up to
run under [pm2](https://pm2.keymetrics.io/), a free process manager, so it:
- keeps running after you close the terminal window
- restarts itself automatically if it crashes
- comes back up automatically when you log back into Windows (after the
  one-time setup below)

### One-time setup
```
npm install -g pm2 pm2-windows-startup
pm2-startup install
```

### Start it
```
pm2 start ecosystem.config.cjs
pm2 save
```
`pm2 save` remembers this as the process list to resurrect on login.

### Useful commands
```
pm2 status              # is it running?
pm2 logs whatsapp-persona-bot     # live logs
pm2 restart whatsapp-persona-bot  # e.g. after editing .env
pm2 stop whatsapp-persona-bot
```

Moving it to a small always-on cloud server later is also an option if you
ever want it running on something other than your own PC — ask and I can
help set that up (note: that means a third party host holds your live
WhatsApp session, which is a real trust tradeoff to weigh).

## Files in this project

- `src/index.js` — connects to WhatsApp, decides when to reply, sends messages
- `src/persona.js` — builds the "who you are" instructions sent to Claude
- `src/replyEngine.js` — calls the Claude API to write each reply
- `src/styleLearner.js` — logs your real outgoing messages to learn your voice
- `src/rateLimiter.js` — spacing and caps to keep replies human-plausible
- `data/persona-seed.md` — **edit this** — your tone, skills, rates, examples
- `data/style-log.jsonl` — auto-built log of your real messages (don't share this file, it's personal)
- `logs/auto-replies.log` — audit trail of everything the bot sent
