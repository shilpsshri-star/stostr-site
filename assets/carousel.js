// Featured-clients carousel: arrows, dots, swipe (native scroll-snap), gentle autoplay that stops on interaction.
(function () {
  var root = document.getElementById("featured"); if (!root) return;
  var track = root.querySelector(".car-track"), slides = root.querySelectorAll(".slide"), dots = root.querySelectorAll(".car-dots button");
  var i = 0, timer = null, reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function go(n, smooth) { i = (n + slides.length) % slides.length; track.scrollTo({ left: i * track.clientWidth, behavior: smooth === false || reduce ? "auto" : "smooth" }); mark(); }
  function mark() { dots.forEach(function (d, k) { d.setAttribute("aria-selected", String(k === i)); }); }
  function stop() { clearInterval(timer); timer = null; }
  root.querySelectorAll(".car-btn").forEach(function (b) { b.onclick = function () { stop(); go(i + Number(b.dataset.dir)); }; });
  dots.forEach(function (d, k) { d.onclick = function () { stop(); go(k); }; });
  var t; track.addEventListener("scroll", function () { clearTimeout(t); t = setTimeout(function () { var w = track.clientWidth; i = Math.round(track.scrollLeft / w); mark(); }, 80); });
  track.addEventListener("keydown", function (e) { if (e.key === "ArrowRight") { stop(); go(i + 1); } if (e.key === "ArrowLeft") { stop(); go(i - 1); } });
  ["pointerdown", "touchstart", "focusin"].forEach(function (ev) { root.addEventListener(ev, stop, { passive: true }); });
  if (!reduce) timer = setInterval(function () { go(i + 1); }, 8000);
})();
