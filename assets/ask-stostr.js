// "Ask about stostr": a small rule-based assistant. Answers only from the facts below;
// anything else goes to email. No AI calls, no tracking, nothing stored.
(function () {
  var EMAIL = "stostr.team@gmail.com";
  var MAIL = '<a href="mailto:' + EMAIL + '?subject=Question%20from%20stostr.com">' + EMAIL + "</a>";

  var KB = [
    { k: ["who", "shilpa", "background", "experience", "founder", "behind", "yourself", "owner"],
      a: "stostr is run by Shilpa: 15+ years in digital product for fintech and corporate payments, an MBA from UVA Darden and a Product Management certificate from Cornell. She's based in Ashburn, Virginia and works with small businesses anywhere, remotely." },
    { k: ["service", "services", "offer", "set up", "setup", "what do you"],
      a: 'Four areas: <b>get found</b> (listings, social, a simple site), <b>get paid</b> (payments, online ordering, invoices), <b>run smoothly</b> (trackers and automations) and <b>grow</b> (measure, test one change, keep what works). <a href="/services">How each one works →</a>' },
    { k: ["agent", "agents", "ai", "automation", "automate", "chatbot", "assistant", "claude"],
      a: 'Yes: small AI helpers that do one job well, like answering customer questions from your own menu, pulling your sales and social numbers into one sheet each morning, or a Monday note on what changed. Each one has a person approving anything that goes out. <a href="/#agents">See the ones running now →</a>' },
    { k: ["price", "prices", "pricing", "cost", "rate", "charge", "fee", "how much", "quote", "budget"],
      a: "Every project gets a fixed quote after the free call, so you know the cost and the finish date before anything starts. No hourly surprises." },
    { k: ["call", "ops check", "free call", "book", "get started", "consult", "meeting"],
      a: 'The first step is a free 20-minute ops check. Email ' + MAIL + ' with a line about your business and what\'s getting in the way; you\'ll get a reply the same day with a time.' },
    { k: ["your work", "case", "portfolio", "examples", "clients", "projects", "results"],
      a: 'Live projects: <a href="/radhashomemade">Radha\'s Homemade</a> (menu, ordering and a question assistant), <a href="/miradesigns">Made With Mira Studio</a> (Etsy growth and calendars) and Patti\'s Little Studio (photo-to-listing tool). <a href="/work">Read the case studies →</a>' },
    { k: ["radha", "kitchen", "food", "masala", "sauce"],
      a: 'Radha\'s Homemade is a home food business in Katy, Texas. stostr built the ordering page, a question assistant that answers from the menu, and daily tracking from Instagram, Facebook and Square. <a href="/work/radhas-kitchen">Case study →</a>' },
    { k: ["mira", "etsy", "calendar", "design", "studio"],
      a: 'Made With Mira Studio is a design shop: festival calendars, planners and graphics. stostr rewrote its listings for search and runs a weekly test-one-change growth loop. <a href="/work/mira-studio">Case study →</a>' },
    { k: ["tools", "square", "shopify", "google", "sheets", "canva", "instagram", "facebook", "software", "apps"],
      a: "Usually the tools you already have: Square, Etsy, Google Sheets and Drive, Canva, Instagram and Facebook, Jotform, plus Claude for the AI parts. The goal is fewer apps, set up properly." },
    { k: ["where are", "location", "remote", "virginia", "based"],
      a: "Based in Ashburn, Virginia. Everything can be done remotely, with screen-share calls." },
    { k: ["how long", "timeline", "turnaround", "how fast", "deadline"],
      a: "It depends on the setup, and every quote includes a finish date. You get a walkthrough at handover so it keeps working." },
    { k: ["upkeep", "monthly", "maintain", "maintenance", "ongoing", "retainer"],
      a: "Monthly upkeep is available if you want it, to keep trackers and automations running. It's optional." },
    { k: ["contact", "email", "reach", "hire", "phone"],
      a: "Email " + MAIL + ". Replies come the same day." }
  ];

  function norm(s) { return " " + s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ") + " "; }
  function answer(q) {
    var n = norm(q), best = null, score = 0;
    KB.forEach(function (it) {
      var s = 0;
      it.k.forEach(function (w) { if (n.indexOf(" " + w + " ") > -1 || (w.length > 4 && n.indexOf(w) > -1)) s += w.indexOf(" ") > -1 ? 2 : 1; });
      if (s > score) { score = s; best = it; }
    });
    if (/^\s*(hi|hello|hey)\b/i.test(q) && score === 0) return "Hi! Ask about services, the free ops check, case studies or AI helpers.";
    return best ? best.a : "I'm not sure about that one. Email " + MAIL + " and Shilpa will answer personally.";
  }

  var css = document.createElement("style");
  css.textContent =
    ".ask-btn{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:40;border:0;border-radius:999px;padding:12px 18px;font:600 0.95rem var(--body);background:var(--slate);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.22);cursor:pointer}" +
    ".ask-btn span{color:var(--gold-1)}" +
    ".ask-panel{position:fixed;right:18px;bottom:calc(76px + env(safe-area-inset-bottom,0px));z-index:41;width:min(380px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 120px));display:none;flex-direction:column;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.2);overflow:hidden}" +
    ".ask-panel.open{display:flex}" +
    ".ask-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line);font-family:var(--display);font-weight:700}" +
    ".ask-head button{border:0;background:none;color:var(--muted);font-size:1.3rem;cursor:pointer;line-height:1}" +
    ".ask-log{flex:1;overflow:auto;padding:14px;display:grid;gap:10px;align-content:start;font-size:0.93rem}" +
    ".ask-log .m{padding:9px 12px;border-radius:10px;max-width:90%}" +
    ".ask-log .bot{background:var(--chip)}.ask-log .me{background:var(--slate);color:#fff;justify-self:end}" +
    ".ask-log a{color:var(--gold);font-weight:600}" +
    ".ask-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}" +
    ".ask-chips button{border:1px solid var(--line);background:none;color:var(--ink);border-radius:999px;padding:5px 10px;font:500 0.8rem var(--body);cursor:pointer}" +
    ".ask-form{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--line)}" +
    ".ask-form input{flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font:inherit;font-size:16px;background:var(--paper);color:var(--ink)}" +
    ".ask-form button{border:0;border-radius:8px;padding:0 14px;background:var(--slate);color:#fff;font-weight:600;cursor:pointer}" +
    ".ask-note{font-size:0.72rem;color:var(--muted);padding:0 14px 10px}";
  document.head.appendChild(css);

  var btn = document.createElement("button");
  btn.className = "ask-btn"; btn.type = "button"; btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = "Ask about <span>stostr</span>";
  var p = document.createElement("div");
  p.className = "ask-panel"; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Ask about stostr");
  p.innerHTML = '<div class="ask-head">Ask about stostr<button type="button" aria-label="Close">×</button></div>' +
    '<div class="ask-log" aria-live="polite"></div>' +
    '<div class="ask-chips"></div>' +
    '<form class="ask-form"><input type="text" placeholder="Type a question" aria-label="Your question" maxlength="200"><button>Ask</button></form>' +
    '<div class="ask-note">Answers come from a fixed list of facts. Anything else goes to Shilpa by email.</div>';
  document.body.appendChild(btn); document.body.appendChild(p);

  var log = p.querySelector(".ask-log"), input = p.querySelector("input");
  function say(html, who) { var d = document.createElement("div"); d.className = "m " + who; if (who === "me") d.textContent = html; else d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; }
  function ask(q) { q = q.trim(); if (!q) return; say(q, "me"); setTimeout(function () { say(answer(q), "bot"); }, 250); }
  ["Who's behind stostr?", "What do you set up?", "Do you build AI agents?", "How does pricing work?", "Book the free call"].forEach(function (c) {
    var b = document.createElement("button"); b.type = "button"; b.textContent = c; b.onclick = function () { ask(c); };
    p.querySelector(".ask-chips").appendChild(b);
  });
  say("Hi! I can answer quick questions about stostr: who runs it, what gets set up, AI helpers, pricing and how to start.", "bot");
  function toggle(open) { p.classList.toggle("open", open); btn.setAttribute("aria-expanded", String(open)); if (open) input.focus(); }
  btn.onclick = function () { toggle(!p.classList.contains("open")); };
  p.querySelector(".ask-head button").onclick = function () { toggle(false); btn.focus(); };
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && p.classList.contains("open")) { toggle(false); btn.focus(); } });
  p.querySelector("form").onsubmit = function (e) { e.preventDefault(); ask(input.value); input.value = ""; };
})();
