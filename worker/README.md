# Vote backend

The site is static (GitHub Pages), so votes are stored by this small Cloudflare Worker
with a D1 database. Each IP address gets 20 votes in total; IPs are stored as SHA-256 hashes.

## Deploy with Wrangler

```sh
cd worker
npx wrangler d1 create cooking-votes     # paste the database_id it prints into wrangler.toml
npx wrangler deploy                      # prints the worker URL
```

## Deploy from the Cloudflare dashboard

1. Storage & Databases → D1 → Create database → name it `cooking-votes`.
2. Workers & Pages → Create → Start with Hello World → name it `cooking-votes` → Deploy.
3. Edit code → replace everything with `vote.js` → Deploy.
4. Worker → Settings → Bindings → Add → D1 database → variable name `DB` → pick `cooking-votes`.

## Hook up the site

Copy the worker URL (for example `https://cooking-votes.<account>.workers.dev`) into
`VOTE_URL` at the top of `index.html`. Tables are created automatically on first request.
