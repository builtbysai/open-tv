# Open TV control relay

The Worker behind **Play on TV**: one Durable Object per TV relays control messages
between the TV and its paired phones. It never carries media or guide data. See
[docs/REMOTE.md](../docs/REMOTE.md) for the design, the message list and the cost rules.

```bash
npm install
npm run dev        # wrangler dev on :8787 (set ALLOWED_ORIGINS to "*" for local use)
node test/smoke.mjs
npm run deploy     # after `npx wrangler login`; set ALLOWED_ORIGINS in wrangler.toml
```
