// Cloudflare Worker that stores votes in a D1 database (binding: DB).
// GET  -> { votes: { "<dish #>": count }, voters: { "<dish #>": distinct voters }, mine: { "<dish #>": my votes }, remaining }
// POST { dish } -> { votes: <new count>, voters, remaining } or 429 once the IP has used all its votes.

const LIMIT = 20;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

let ready;
function init(db) {
  ready ??= db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS votes (dish TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS voters (ip TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS ballots (ip TEXT, dish TEXT, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ip, dish))"),
  ]);
  return ready;
}

// IPs are stored hashed, not in the clear.
async function voterId(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    await init(env.DB);
    const ip = await voterId(request);

    if (request.method === "GET") {
      const [{ results }, voter, counts, mine] = await Promise.all([
        env.DB.prepare("SELECT dish, n FROM votes").all(),
        env.DB.prepare("SELECT n FROM voters WHERE ip = ?").bind(ip).first(),
        env.DB.prepare("SELECT dish, COUNT(*) AS n FROM ballots GROUP BY dish").all(),
        env.DB.prepare("SELECT dish, n FROM ballots WHERE ip = ?").bind(ip).all(),
      ]);
      const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.dish, r.n]));
      return json({ votes: toMap(results), voters: toMap(counts.results), mine: toMap(mine.results), remaining: LIMIT - (voter?.n || 0) });
    }

    if (request.method === "POST") {
      const { dish } = await request.json().catch(() => ({}));
      if (!dish) return json({ error: "Missing dish" }, 400);

      // Atomically count the vote against this IP; no row comes back once the limit is hit.
      const voter = await env.DB
        .prepare("INSERT INTO voters (ip, n) VALUES (?, 1) ON CONFLICT(ip) DO UPDATE SET n = n + 1 WHERE n < ? RETURNING n")
        .bind(ip, LIMIT)
        .first();
      if (!voter) return json({ error: `You have used all ${LIMIT} votes`, remaining: 0 }, 429);

      const [row, , voters] = await env.DB.batch([
        env.DB.prepare("INSERT INTO votes (dish, n) VALUES (?, 1) ON CONFLICT(dish) DO UPDATE SET n = n + 1 RETURNING n").bind(String(dish)),
        env.DB.prepare("INSERT INTO ballots (ip, dish, n) VALUES (?, ?, 1) ON CONFLICT(ip, dish) DO UPDATE SET n = n + 1").bind(ip, String(dish)),
        env.DB.prepare("SELECT COUNT(*) AS n FROM ballots WHERE dish = ?").bind(String(dish)),
      ]);
      return json({ votes: row.results[0].n, voters: voters.results[0].n, remaining: LIMIT - voter.n });
    }

    return json({ error: "Method not allowed" }, 405);
  },
};
