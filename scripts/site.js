(function () {
  "use strict";

  var nav = document.getElementById("nav");
  var navToggle = document.getElementById("navToggle");
  var navLinks = document.getElementById("navLinks");
  window.addEventListener("scroll", function () {
    if (nav) nav.classList.toggle("scrolled", window.scrollY > 10);
  }, { passive: true });
  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () {
      var open = navLinks.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(open));
    });
    navLinks.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navLinks.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) entry.target.classList.add("revealed");
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });
    document.querySelectorAll(".reveal").forEach(function (element) { observer.observe(element); });
  } else {
    document.querySelectorAll(".reveal").forEach(function (element) { element.classList.add("revealed"); });
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var canvas = document.getElementById("fairy-canvas");
  if (!canvas) return;
  var context = canvas.getContext("2d");
  if (!context) return;
  var particles = [];
  var width = 0;
  var height = 0;
  var dark = window.matchMedia("(prefers-color-scheme: dark)");

  function resize() {
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function reset(particle, randomY) {
    particle.x = Math.random() * width;
    particle.y = randomY ? Math.random() * height : height + 8;
    particle.vx = (Math.random() - 0.5) * 0.22;
    particle.vy = -(0.12 + Math.random() * 0.34);
    particle.life = 180 + Math.random() * 420;
    particle.age = Math.random() * particle.life;
    particle.size = 0.5 + Math.random() * 1.1;
    particle.accent = Math.random() < 0.09;
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    particles.forEach(function (particle) {
      particle.age += 1;
      particle.x += particle.vx + Math.sin((particle.y + particle.age) * 0.007) * 0.08;
      particle.y += particle.vy;
      if (particle.age > particle.life || particle.y < -12) reset(particle, false);
      var fade = Math.min(particle.age / 50, (particle.life - particle.age) / 70, 1);
      var color = particle.accent ? (dark.matches ? "214,106,85" : "196,69,49") : (dark.matches ? "85,169,203" : "22,133,169");
      context.fillStyle = "rgba(" + color + "," + Math.max(0, fade) * 0.34 + ")";
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      context.fill();
    });
    window.requestAnimationFrame(draw);
  }

  resize();
  for (var index = 0; index < 76; index += 1) {
    var particle = {};
    reset(particle, true);
    particles.push(particle);
  }
  window.addEventListener("resize", resize);
  draw();
})();
