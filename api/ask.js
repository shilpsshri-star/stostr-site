// Radha's Homemade Q&A: AI fallback for questions the rule-based assistant can't match.
// The model may only answer from knowledge.json. Anything about money, health or policy goes to Radha.
// Needs ANTHROPIC_API_KEY set in Vercel → Project → Settings → Environment Variables.
// Without it this returns 503 and the widget hands the question to Radha instead.

const KB = require("../radhashomemade/knowledge.json");

const MODEL = "claude-haiku-4-5-20251001";
const HITS = new Map();                       // tiny per-instance rate limit: 20 questions / 10 min / IP

const SYSTEM = `You answer customer questions for Radha's Homemade, a small home food business in Katy, Texas.
Use ONLY the facts in the JSON below. Never invent prices, ingredients, allergens, hours, dates or promises.
If the answer isn't in the facts, say you're not sure and tell them to call or text Radha at ${KB.ordering.phone}.
Refunds, complaints, allergies, health questions, custom or bulk orders: don't answer yourself, hand off to Radha.
Reply in 1 to 3 short, warm sentences. Plain text, no markdown.
If you handed off or weren't sure, end your reply with the token [HANDOFF].

FACTS:
${JSON.stringify(KB)}`;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "AI fallback not configured" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || "anon";
  const now = Date.now(), recent = (HITS.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (recent.length >= 20) return res.status(429).json({ error: "Too many questions, try again soon" });
  HITS.set(ip, [...recent, now]);

  const question = String((req.body && req.body.question) || "").slice(0, 300).trim();
  if (!question) return res.status(400).json({ error: "Empty question" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 250, system: SYSTEM, messages: [{ role: "user", content: question }] })
    });
    if (!r.ok) throw new Error("upstream " + r.status);
    const j = await r.json();
    let answer = (j.content || []).map(c => c.text || "").join("").trim();
    const handoff = /\[HANDOFF\]/.test(answer);
    answer = answer.replace(/\s*\[HANDOFF\]\s*/g, " ").trim();
    // Log the question (text only, no personal data) so the rules and menu data can grow over time.
    console.log(JSON.stringify({ qa: "ai", question, handoff }));
    return res.status(200).json({ answer, handoff });
  } catch (e) {
    console.log(JSON.stringify({ qa: "error", question, error: String(e.message || e) }));
    return res.status(502).json({ error: "AI unavailable" });
  }
};
