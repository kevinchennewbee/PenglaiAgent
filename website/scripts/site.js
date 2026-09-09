(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var nav = document.getElementById("nav");
  var navToggle = document.getElementById("navToggle");
  var navLinks = document.getElementById("navLinks");
  var hairline = document.getElementById("scrollHairline");
  var lastToggle = null;

  function setMotionFlag() {
    document.documentElement.dataset.motion = reduce.matches ? "reduce" : "ok";
  }

  function closeNav() {
    if (!navLinks || !navToggle) return;
    navLinks.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  }

  function updateScroll() {
    if (nav) nav.classList.toggle("scrolled", window.scrollY > 8);
    if (!hairline) return;
    var span = document.documentElement.scrollHeight - window.innerHeight;
    var progress = span > 0 ? Math.min(1, Math.max(0, window.scrollY / span)) : 0;
    hairline.style.transform = "scaleX(" + progress + ")";
  }

  function computerFamily() {
    var ua = navigator.userAgent || "";
    var platform = navigator.platform || "";
    var ch = navigator.userAgentData && navigator.userAgentData.platform;
    var token = String(ch || platform || ua).toLowerCase();
    if (token.indexOf("win") >= 0) return "windows";
    if (token.indexOf("mac") >= 0) return "mac";
    if (token.indexOf("linux") >= 0 || token.indexOf("cros") >= 0) return "linux";
    if (/Windows/i.test(ua)) return "windows";
    if (/Mac OS|Macintosh/i.test(ua)) return "mac";
    if (/Linux/i.test(ua) && !/Android/i.test(ua)) return "linux";
    return "";
  }

  function hintDownloads() {
    var family = computerFamily();
    if (!family) return;
    var cards = document.querySelectorAll("[data-family]");
    if (!cards.length) return;
    var matched = [];
    cards.forEach(function (card) {
      if (card.getAttribute("data-family") === family) {
        card.classList.add("is-likely");
        matched.push(card);
      }
    });
    if (!matched.length) return;
    var note = document.getElementById("downloadHint");
    if (!note) return;
    var copy = note.getAttribute("data-" + family);
    if (copy) {
      note.hidden = false;
      note.textContent = copy;
    }
  }

  setMotionFlag();
  updateScroll();
  hintDownloads();
  window.addEventListener("scroll", updateScroll, { passive: true });
  window.addEventListener("resize", function () {
    if (window.innerWidth > 880) closeNav();
    updateScroll();
  });
  reduce.addEventListener("change", setMotionFlag);

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () {
      var open = navLinks.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(open));
      lastToggle = navToggle;
      if (open) {
        var first = navLinks.querySelector("a");
        if (first) first.focus();
      }
    });
    navLinks.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeNav);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && navLinks.classList.contains("open")) {
        closeNav();
        if (lastToggle) lastToggle.focus();
      }
    });
  }

  if (!reduce.matches && "IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );
    document.querySelectorAll("[data-reveal]").forEach(function (node) {
      observer.observe(node);
    });
  } else {
    document.querySelectorAll("[data-reveal]").forEach(function (node) {
      node.classList.add("is-in");
    });
  }
})();
