(() => {
  "use strict";

  const host = document.querySelector(".game-frame");
  const baseCanvas = document.getElementById("gameCanvas");
  const badge = document.getElementById("shieldBadge");
  const countEl = document.getElementById("shieldCount");
  const engine = window.SnakeLiveTest?.engine;

  if (!host || !baseCanvas || !engine) return;

  const overlay = document.createElement("canvas");
  overlay.width = baseCanvas.width;
  overlay.height = baseCanvas.height;
  overlay.setAttribute("aria-hidden", "true");
  Object.assign(overlay.style, {
    position: "absolute",
    inset: "8px",
    width: "calc(100% - 16px)",
    height: "calc(100% - 16px)",
    borderRadius: "15px",
    pointerEvents: "none",
    zIndex: "5"
  });
  host.appendChild(overlay);

  const ctx = overlay.getContext("2d");
  let previousShields = engine.shields;
  let breakFlashUntil = 0;
  let activateFlashUntil = 0;
  let lastActive = engine.shields > 0;
  let shards = [];

  function spawnBreakEffect() {
    const head = engine.snake?.[0];
    if (!head) return;

    const cellW = overlay.width / engine.columns;
    const cellH = overlay.height / engine.rows;
    const cx = (head.x + 0.5) * cellW;
    const cy = (head.y + 0.5) * cellH;
    const now = performance.now();

    breakFlashUntil = now + 520;
    shards = [];

    for (let i = 0; i < 28; i += 1) {
      const angle = (Math.PI * 2 * i) / 28 + Math.random() * 0.28;
      const speed = 95 + Math.random() * 180;
      shards.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        bornAt: now,
        life: 380 + Math.random() * 300,
        size: 3 + Math.random() * 6,
        spin: Math.random() * Math.PI
      });
    }
  }

  function drawHexagon(cx, cy, radius, rotation, alpha, lineWidth) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(82,226,255,${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.shadowColor = `rgba(37,229,255,${Math.min(0.85, alpha + 0.15)})`;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();
  }

  function drawShieldAura(now) {
    if (engine.shields <= 0 || !engine.snake?.length) return;

    const cellW = overlay.width / engine.columns;
    const cellH = overlay.height / engine.rows;
    const pulse = 0.5 + 0.5 * Math.sin(now / 230);

    // Soft glow around the full snake body.
    engine.snake.forEach((part, index) => {
      const cx = (part.x + 0.5) * cellW;
      const cy = (part.y + 0.5) * cellH;
      const radius = Math.min(cellW, cellH) * (index === 0 ? 0.72 : 0.55);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, `rgba(78,232,255,${index === 0 ? 0.16 + pulse * 0.09 : 0.065})`);
      gradient.addColorStop(0.58, `rgba(39,157,255,${index === 0 ? 0.08 : 0.025})`);
      gradient.addColorStop(1, "rgba(37,229,255,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    const head = engine.snake[0];
    const cx = (head.x + 0.5) * cellW;
    const cy = (head.y + 0.5) * cellH;
    const size = Math.min(cellW, cellH);

    // Main force-field rings around the head.
    drawHexagon(cx, cy, size * (0.73 + pulse * 0.07), now / 2300, 0.55 + pulse * 0.25, 2.4);
    drawHexagon(cx, cy, size * (0.92 + (1 - pulse) * 0.08), -now / 3100, 0.18 + pulse * 0.13, 1.4);

    // Orbiting sparks make the protection readable even on a small phone screen.
    for (let i = 0; i < 5; i += 1) {
      const angle = now / 520 + i * (Math.PI * 2 / 5);
      const radius = size * 0.86;
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius;
      ctx.shadowColor = "#53edff";
      ctx.shadowBlur = 10;
      ctx.fillStyle = `rgba(174,247,255,${0.55 + pulse * 0.35})`;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.5, size * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function drawBreakEffect(now, deltaSeconds) {
    if (now < breakFlashUntil) {
      const remaining = Math.max(0, (breakFlashUntil - now) / 520);
      const head = engine.snake?.[0];
      if (head) {
        const cellW = overlay.width / engine.columns;
        const cellH = overlay.height / engine.rows;
        const cx = (head.x + 0.5) * cellW;
        const cy = (head.y + 0.5) * cellH;
        const size = Math.min(cellW, cellH);
        const p = 1 - remaining;

        ctx.strokeStyle = `rgba(123,238,255,${remaining})`;
        ctx.lineWidth = Math.max(1.5, 5 * remaining);
        ctx.shadowColor = "#42e8ff";
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(cx, cy, size * (0.55 + p * 1.75), 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = `rgba(88,226,255,${remaining * 0.12})`;
      ctx.fillRect(0, 0, overlay.width, overlay.height);
    }

    shards = shards.filter((particle) => {
      const age = now - particle.bornAt;
      if (age >= particle.life) return false;
      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      particle.vx *= 0.985;
      particle.vy *= 0.985;
      const alpha = 1 - age / particle.life;

      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.spin + age / 190);
      ctx.fillStyle = `rgba(126,241,255,${alpha})`;
      ctx.shadowColor = "#25e5ff";
      ctx.shadowBlur = 9;
      ctx.beginPath();
      ctx.moveTo(0, -particle.size);
      ctx.lineTo(particle.size * 0.75, particle.size * 0.55);
      ctx.lineTo(-particle.size * 0.75, particle.size * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return true;
    });
  }

  function updateBadge(now) {
    const active = engine.shields > 0;
    if (active && !lastActive) activateFlashUntil = now + 550;
    lastActive = active;

    if (!badge) return;

    if (active) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 260);
      badge.style.background = "rgba(4,31,48,.94)";
      badge.style.borderColor = `rgba(72,229,255,${0.52 + pulse * 0.35})`;
      badge.style.color = "#a7f4ff";
      badge.style.boxShadow = `0 0 ${10 + pulse * 12}px rgba(37,229,255,.32)`;
      if (countEl) countEl.textContent = `x${engine.shields}`;
    } else {
      badge.style.boxShadow = "";
      badge.style.background = "";
      badge.style.borderColor = "";
      badge.style.color = "";
    }

    if (now < activateFlashUntil) {
      const alpha = Math.max(0, (activateFlashUntil - now) / 550);
      ctx.fillStyle = `rgba(72,224,255,${alpha * 0.08})`;
      ctx.fillRect(0, 0, overlay.width, overlay.height);
    }
  }

  let lastFrame = performance.now();
  function animate(now) {
    const deltaSeconds = Math.min(0.04, (now - lastFrame) / 1000);
    lastFrame = now;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (engine.shields < previousShields) spawnBreakEffect();
    previousShields = engine.shields;

    drawShieldAura(now);
    drawBreakEffect(now, deltaSeconds);
    updateBadge(now);
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
})();
