(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  if (!canvas || !window.SnakeLiveTest?.engine) return;

  const ctx = canvas.getContext("2d");
  const engine = window.SnakeLiveTest.engine;
  const bursts = [];
  let lastSeenEatenKey = "";

  function loop(now) {
    drawNormalFoods(now);
    detectRoseEat(now);
    drawRoseBursts(now);
    requestAnimationFrame(loop);
  }

  function drawNormalFoods(now) {
    const cellW = canvas.width / engine.columns;
    const cellH = canvas.height / engine.rows;
    const size = Math.min(cellW, cellH);

    for (const food of engine.food) {
      if (food.type === "special") continue;

      const cx = (food.x + 0.5) * cellW;
      const cy = (food.y + 0.5) * cellH;
      const viewerGift = food.user && food.user !== "JOGO";
      const age = Math.max(0, Date.now() - (food.createdAt || Date.now()));
      const spawn = Math.min(1, age / 210);
      const pulse = 1 + Math.sin(now / 190 + food.x * 0.65 + food.y * 0.42) * (viewerGift ? 0.05 : 0.025);
      const scale = easeOutBack(spawn) * pulse;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);

      if (viewerGift) {
        const haloRadius = size * (0.48 + 0.035 * Math.sin(now / 170));
        const halo = ctx.createRadialGradient(0, 0, size * 0.10, 0, 0, haloRadius);
        halo.addColorStop(0, "rgba(255,90,126,.25)");
        halo.addColorStop(0.52, "rgba(255,61,120,.12)");
        halo.addColorStop(1, "rgba(255,61,120,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
        ctx.fill();

        for (let i = 0; i < 3; i += 1) {
          const a = now / 720 + i * (Math.PI * 2 / 3) + food.x * 0.13;
          const r = size * 0.41;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          drawPetal(px, py, size * 0.045, a + Math.PI / 2, 0.78);
        }
      }

      drawApple(size, viewerGift);

      if (viewerGift) {
        ctx.font = `900 ${Math.max(9, size * 0.20)}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffd7e4";
        ctx.shadowColor = "#ff4f88";
        ctx.shadowBlur = 7;
        ctx.fillText("🌹", 0, -size * 0.47);
        ctx.shadowBlur = 0;
      }

      ctx.restore();
    }
  }

  function drawApple(size, viewerGift) {
    const radius = size * 0.245;

    ctx.shadowColor = viewerGift ? "rgba(255,58,104,.95)" : "rgba(255,70,100,.65)";
    ctx.shadowBlur = viewerGift ? 12 : 7;

    const grad = ctx.createRadialGradient(-radius * 0.35, -radius * 0.4, 1, 0, 0, radius * 1.25);
    grad.addColorStop(0, "#ff8c9e");
    grad.addColorStop(0.35, "#ff4968");
    grad.addColorStop(1, "#b9143d");
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.arc(-radius * 0.45, size * 0.035, radius * 0.78, 0, Math.PI * 2);
    ctx.arc(radius * 0.45, size * 0.035, radius * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#7a291f";
    ctx.save();
    ctx.rotate(0.13);
    ctx.fillRect(-size * 0.025, -size * 0.34, size * 0.05, size * 0.17);
    ctx.restore();

    ctx.fillStyle = "#63df72";
    ctx.beginPath();
    ctx.ellipse(size * 0.11, -size * 0.28, size * 0.12, size * 0.06, -0.48, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,.34)";
    ctx.beginPath();
    ctx.ellipse(-size * 0.105, -size * 0.075, size * 0.055, size * 0.025, -0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  function detectRoseEat(now) {
    const eaten = engine.lastEaten;
    if (!eaten || eaten.type === "special" || !eaten.user || eaten.user === "JOGO") return;

    const key = `${eaten.createdAt || 0}:${eaten.x}:${eaten.y}`;
    if (key === lastSeenEatenKey) return;
    lastSeenEatenKey = key;

    bursts.push({
      x: eaten.x,
      y: eaten.y,
      user: eaten.user,
      startedAt: now
    });
  }

  function drawRoseBursts(now) {
    const cellW = canvas.width / engine.columns;
    const cellH = canvas.height / engine.rows;
    const size = Math.min(cellW, cellH);

    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      const burst = bursts[i];
      const elapsed = now - burst.startedAt;
      const p = elapsed / 620;
      if (p >= 1) {
        bursts.splice(i, 1);
        continue;
      }

      const cx = (burst.x + 0.5) * cellW;
      const cy = (burst.y + 0.5) * cellH;
      const alpha = 1 - p;

      ctx.save();

      ctx.strokeStyle = `rgba(255,88,132,${0.68 * alpha})`;
      ctx.lineWidth = Math.max(1.5, size * 0.045 * alpha);
      ctx.beginPath();
      ctx.arc(cx, cy, size * (0.18 + p * 0.78), 0, Math.PI * 2);
      ctx.stroke();

      for (let j = 0; j < 9; j += 1) {
        const angle = j * (Math.PI * 2 / 9) + 0.26;
        const distance = size * (0.16 + p * (0.52 + (j % 3) * 0.08));
        const px = cx + Math.cos(angle) * distance;
        const py = cy + Math.sin(angle) * distance + p * p * size * 0.22;
        ctx.save();
        ctx.translate(px, py);
        drawPetal(0, 0, size * 0.055, angle + p * 2.4, alpha);
        ctx.restore();
      }

      ctx.globalAlpha = alpha;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `950 ${Math.max(14, size * 0.40)}px system-ui`;
      ctx.fillStyle = "#ffe0ea";
      ctx.shadowColor = "#ff4f88";
      ctx.shadowBlur = 10;
      ctx.fillText("+1", cx, cy - size * (0.30 + p * 0.72));
      ctx.shadowBlur = 0;

      ctx.font = `800 ${Math.max(8, size * 0.18)}px system-ui`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`@${burst.user}`, cx, cy - size * (0.04 + p * 0.72));

      ctx.restore();
    }
  }

  function drawPetal(x, y, radius, rotation, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = "#ff6d9d";
    ctx.shadowColor = "#ff3d78";
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.72, radius * 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const n = Math.max(0, Math.min(1, t));
    return 1 + c3 * Math.pow(n - 1, 3) + c1 * Math.pow(n - 1, 2);
  }

  requestAnimationFrame(loop);
})();
