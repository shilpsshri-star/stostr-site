/* Radha's Homemade: grounded Q&A assistant
 * 1. Hard-stop topics (refunds, complaints, allergies, custom/bulk orders) → hand off to Radha. Never improvised.
 * 2. Rule-based answers straight from knowledge.json (no AI, instant, free).
 * 3. Anything else → /api/ask (AI that may only use knowledge.json). If that's unavailable → hand off.
 */
(function () {
  const KB_URL = "/radhashomemade/knowledge.json";
  const API = "/api/ask";
  let KB = null;

  const norm = s => s.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();
  const has = (q, words) => words.some(w => new RegExp(`\\b${w}`).test(q));

  /* ---------- answers ---------- */
  function handoff(prefix) {
    return { text: (prefix ? prefix + " " : "") + KB.handoff, actions: ["call"], source: "handoff" };
  }

  function findItems(q) {
    const hits = [];
    KB.categories.forEach(cat => cat.items.forEach(it => {
      const names = [it.name, ...(it.aliases || [])].map(norm);
      if (names.some(n => q.includes(n))) hits.push({ cat, it });
    }));
    return hits;
  }

  function upcomingEvent() {
    const today = new Date().toISOString().slice(0, 10);
    return (KB.events || []).filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  }

  function rules(raw) {
    const q = norm(raw);
    const O = KB.ordering;

    // 1. Hard stops: money, policy, health. Always a human.
    if (has(q, ["refund", "money back", "complain", "complaint", "wrong order", "missing", "sick", "spoiled", "went bad", "never arrived"]))
      return handoff("Sorry to hear that.");
    if (has(q, ["allerg", "gluten", "dairy", "nut free", "nut-free", "celiac", "lactose"]))
      return { text: KB.allergens_from_names + " " + KB.handoff, actions: ["call"], source: "handoff" };
    if (has(q, ["bulk", "catering", "cater", "party order", "wholesale", "custom", "large order", "event order"]))
      return handoff("Happy to help with bigger orders.");

    // 2. Specific dishes
    const items = findItems(q);
    // Details our facts don't cover (spice level, ingredients, storage...) → AI, which hands off if unsure.
    const unknownDetail = has(q, ["spic", "hot", "mild", "ingredient", "calorie", "shelf", "store", "freez", "frozen", "fridge", "how long", "sugar", "salt", "oil", "kid"]);
    if (items.length && unknownDetail) return null;
    if (items.length) {
      const lines = items.slice(0, 3).map(({ cat, it }) =>
        `Yes, we make ${it.name} (${cat.name}). ${it.notes || cat.how_to_use || cat.what}`);
      return { text: lines.join(" ") + " " + O.prices, actions: ["order", "call"], source: "rules" };
    }

    // 3. Topics
    if (has(q, ["price", "cost", "how much"]) || raw.includes("$"))
      return { text: O.prices, actions: ["call"], source: "rules" };
    if (has(q, ["market", "farmers", "where can i find", "taste", "sample"])) {
      const e = upcomingEvent();
      return e ? { text: `Come find us at ${e.name} on ${e.when}. ${e.details}`, actions: ["insta"], source: "rules" }
               : { text: "No market dates are posted right now. Follow @radhaskitchen4u on Instagram for the next one.", actions: ["insta"], source: "rules" };
    }
    const wantsPickup = has(q, ["pick up", "pickup", "pick-up", "collect", "where are you", "location", "address", "katy"]);
    if (has(q, ["deliver"]))
      return { text: (wantsPickup ? O.pickup + " " : "") + O.delivery, actions: ["call"], source: "rules" };
    if (wantsPickup)
      return { text: O.pickup + " " + O.how, actions: ["order", "call"], source: "rules" };
    if (has(q, ["hour", "open", "when can", "what time", "today", "tomorrow", "weekend"]))
      return { text: O.hours, actions: ["call"], source: "rules" };
    if (has(q, ["order", "buy", "pay", "cash app", "cashapp", "purchase", "get some"]))
      return { text: O.how, actions: ["order", "call"], source: "rules" };
    if (has(q, ["vegetarian", "veg", "vegan", "meat", "chicken", "fish", "protein"]))
      return { text: "The 15-Minute Dinner curry sauces are vegetarian, and you add your own protein or veggies. The lentil curries are ready to eat as they are. " + "For vegan questions, " + KB.handoff.charAt(0).toLowerCase() + KB.handoff.slice(1), actions: ["call"], source: "rules" };
    if (has(q, ["menu", "what do you", "what you", "sell", "offer", "products", "have"]))
      return { text: KB.categories.map(c => `${c.name}: ${c.items.map(i => i.name).join(", ")}.`).join(" "), actions: ["order"], source: "rules" };
    if (has(q, ["cook", "make", "prepare", "heat", "how do i use", "how to use", "recipe", "instructions"]))
      return { text: KB.categories.map(c => `${c.name}: ${c.how_to_use || c.what}`).join(" "), actions: [], source: "rules" };
    if (/^(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/.test(q))
      return { text: "Hi! Ask me about our dinners, how to order, pickup and delivery, or the farmers market.", actions: [], source: "rules" };
    return null;
  }

  async function answer(raw) {
    const r = rules(raw);
    if (r) return r;
    try {
      const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: raw.slice(0, 300) }) });
      if (!res.ok) throw 0;
      const j = await res.json();
      if (!j.answer) throw 0;
      return { text: j.answer, actions: j.handoff ? ["call"] : [], source: "ai" };
    } catch (e) {
      return handoff("I'm not sure about that one.");
    }
  }

  /* ---------- UI ---------- */
  const css = `
  .qa-fab{position:fixed;right:16px;bottom:16px;z-index:50;background:var(--spice-1);color:#fff;border:none;border-radius:999px;padding:12px 18px;font:700 0.92rem "Mulish",sans-serif;box-shadow:0 6px 20px rgba(60,20,10,.25);cursor:pointer;}
  .qa-panel{position:fixed;right:16px;bottom:72px;z-index:50;width:min(360px,calc(100vw - 32px));max-height:min(540px,calc(100vh - 100px));display:flex;flex-direction:column;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 40px rgba(60,20,10,.25);overflow:hidden;}
  .qa-panel[hidden]{display:none;}
  .qa-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line);}
  .qa-head b{font-family:"Fraunces",serif;color:var(--spice-1);}
  .qa-head small{display:block;color:var(--muted);font-size:0.72rem;}
  .qa-close{background:none;border:none;color:var(--muted);font-size:1.3rem;cursor:pointer;line-height:1;}
  .qa-log{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px;font-size:0.9rem;}
  .qa-msg{max-width:88%;padding:8px 12px;border-radius:12px;line-height:1.45;}
  .qa-msg.me{align-self:flex-end;background:var(--spice-1);color:#fff;border-bottom-right-radius:4px;}
  .qa-msg.bot{align-self:flex-start;background:var(--chip);border-bottom-left-radius:4px;}
  .qa-msg .src{display:block;font-size:0.68rem;color:var(--muted);margin-top:4px;}
  .qa-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
  .qa-acts a{font-size:0.76rem;font-weight:700;text-decoration:none;color:var(--spice-1);border:1px solid var(--spice-1);border-radius:999px;padding:3px 10px;}
  .qa-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px;}
  .qa-chips button{font:600 0.76rem "Mulish",sans-serif;background:transparent;border:1px solid var(--line);color:var(--ink);border-radius:999px;padding:4px 10px;cursor:pointer;}
  .qa-form{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--line);}
  .qa-form input{flex:1;min-width:0;font:0.9rem "Mulish",sans-serif;padding:9px 12px;border:1px solid var(--line);border-radius:999px;background:var(--paper);color:var(--ink);}
  .qa-form button{font:700 0.85rem "Mulish",sans-serif;background:var(--spice-1);color:#fff;border:none;border-radius:999px;padding:0 14px;cursor:pointer;}
  .qa-note{font-size:0.68rem;color:var(--muted);padding:0 14px 10px;margin:0;}`;

  function mount() {
    const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
    const fab = Object.assign(document.createElement("button"), { className: "qa-fab", type: "button", textContent: "Ask about our food" });
    fab.setAttribute("aria-expanded", "false"); fab.setAttribute("aria-controls", "qa-panel");
    const panel = document.createElement("div");
    panel.className = "qa-panel"; panel.id = "qa-panel"; panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Ask Radha's Kitchen");
    panel.innerHTML = `
      <div class="qa-head"><div><b>Ask Radha's Kitchen</b><small>Answers come from our menu and ordering info</small></div><button class="qa-close" type="button" aria-label="Close">×</button></div>
      <div class="qa-log" aria-live="polite"></div>
      <div class="qa-chips"><button type="button">What's on the menu?</button><button type="button">How do I order?</button><button type="button">Pickup &amp; delivery</button><button type="button">Farmers market</button></div>
      <form class="qa-form"><label for="qa-in" style="position:absolute;left:-9999px">Your question</label><input id="qa-in" maxlength="300" placeholder="e.g. Do you have rajma?" autocomplete="off"><button type="submit">Ask</button></form>
      <p class="qa-note">For allergies, refunds or big orders, Radha answers personally.</p>`;
    document.body.append(fab, panel);
    const log = panel.querySelector(".qa-log"), input = panel.querySelector("input");

    const ACT = {
      order: () => `<a href="${KB.ordering.cash_app}" target="_blank" rel="noopener">Order on Cash App</a>`,
      call: () => `<a href="${KB.ordering.phone_link}">Call / text ${KB.ordering.phone}</a>`,
      insta: () => `<a href="https://instagram.com/radhaskitchen4u" target="_blank" rel="noopener">${KB.business.instagram}</a>`
    };
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    function say(who, text, extra) {
      const m = document.createElement("div"); m.className = "qa-msg " + who;
      m.innerHTML = esc(text) + (extra || ""); log.appendChild(m); log.scrollTop = log.scrollHeight;
    }
    async function ask(q) {
      q = q.trim(); if (!q) return;
      say("me", q); input.value = "";
      const a = await answer(q);
      const acts = (a.actions || []).map(k => ACT[k]()).join("");
      const src = a.source === "ai" ? '<span class="src">AI answer, from our menu info</span>' : "";
      say("bot", a.text, (acts ? `<div class="qa-acts">${acts}</div>` : "") + src);
    }
    function toggle(open) {
      panel.hidden = !open; fab.setAttribute("aria-expanded", String(open));
      if (open) { if (!log.children.length) say("bot", "Hi! I can answer questions about our dinners, ordering, pickup and delivery."); input.focus(); }
      else fab.focus();
    }
    fab.addEventListener("click", () => toggle(panel.hidden));
    panel.querySelector(".qa-close").addEventListener("click", () => toggle(false));
    panel.addEventListener("keydown", e => { if (e.key === "Escape") toggle(false); });
    panel.querySelector("form").addEventListener("submit", e => { e.preventDefault(); ask(input.value); });
    panel.querySelectorAll(".qa-chips button").forEach(b => b.addEventListener("click", () => ask(b.textContent)));
  }

  fetch(KB_URL).then(r => r.json()).then(kb => { KB = kb; mount(); }).catch(() => {});
  window.__radhaQA = { rules: q => KB && rules(q) };   // for testing
})();
