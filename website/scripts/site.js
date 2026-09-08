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

  setMotionFlag();
  updateScroll();
  window.addEventListener("scroll", updateScroll, { passive: true });
  window.addEventListener("resize", function () {
    if (window.innerWidth > 860) closeNav();
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
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    document.querySelectorAll("[data-reveal]").forEach(function (node) {
      observer.observe(node);
    });
  } else {
    document.querySelectorAll("[data-reveal]").forEach(function (node) {
      node.classList.add("is-in");
    });
  }

  if (reduce.matches) return;

  var canvas = document.getElementById("hero-canvas");
  if (!canvas || !canvas.getContext) return;
  var context = canvas.getContext("2d");
  if (!context) return;

  var width = 0;
  var height = 0;
  var grain = document.createElement("canvas");
  var grainContext = grain.getContext("2d");
  var clouds = [
    { x: 0.12, y: 0.22, r: 0.28, speed: 0.000012, tint: [246, 241, 232], alpha: 0.08 },
    { x: 0.62, y: 0.18, r: 0.34, speed: -0.000008, tint: [201, 163, 106], alpha: 0.07 },
    { x: 0.38, y: 0.68, r: 0.4, speed: 0.000006, tint: [196, 92, 38], alpha: 0.05 },
  ];
  var start = performance.now();
  var frame = 0;

  function paintGrain() {
    grain.width = 160;
    grain.height = 160;
    var pixels = grainContext.createImageData(160, 160);
    for (var i = 0; i < pixels.data.length; i += 4) {
      var value = 180 + Math.random() * 50;
      pixels.data[i] = value;
      pixels.data[i + 1] = value - 4;
      pixels.data[i + 2] = value - 10;
      pixels.data[i + 3] = 28 + Math.random() * 18;
    }
    grainContext.putImageData(pixels, 0, 0);
  }

  function resize() {
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || Math.min(window.innerHeight, 860);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw(now) {
    frame = window.requestAnimationFrame(draw);
    var t = now - start;
    context.clearRect(0, 0, width, height);
    clouds.forEach(function (cloud) {
      var x = ((cloud.x + t * cloud.speed) % 1.4) * width - 0.2 * width;
      var y = cloud.y * height;
      var radius = cloud.r * Math.max(width, height);
      var wash = context.createRadialGradient(x, y, radius * 0.12, x, y, radius);
      wash.addColorStop(0, "rgba(" + cloud.tint.join(",") + "," + cloud.alpha + ")");
      wash.addColorStop(1, "rgba(" + cloud.tint.join(",") + ",0)");
      context.fillStyle = wash;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    });
    context.globalAlpha = 0.18;
    context.fillStyle = context.createPattern(grain, "repeat");
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 1;
  }

  paintGrain();
  resize();
  window.addEventListener("resize", resize);
  reduce.addEventListener("change", function () {
    if (reduce.matches) {
      window.cancelAnimationFrame(frame);
      context.clearRect(0, 0, width, height);
    }
  });
  draw(start);
})();
