(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  if (!canvas || !window.SnakeLiveTest?.engine) return;

  const ctx = canvas.getContext("2d");
  const engine = window.SnakeLiveTest.engine;
  let lastSeenEatenKey = "";
  const bursts = [];

  function loop(now) {
    drawSpecialFoods(now);
    detectSpecialEat(now);
    drawBursts(now);
    requestAnimationFrame(loop);
  }

  function drawSpecialFoods(now) {
    const cellW = canvas.width / engine.columns;
    const cellH = canvas.height / engine.rows;
    const size = Math.min(cellW, cellH);

    for (const food of engine.food) {
      if (food.type !== "special") continue;

      const cx = (food.x + 0.5) * cellW;
      const cy = (food.y + 0.5) * cellH;
      const age = Math.max(0, Date.now() - (food.createdAt || Date.now()));
      const spawn = Math.min(1, age / 260);
      const pulse = 1 + Math.sin(now / 150 + food.x * 0.7 + food.y * 0.4) * 0.06;
      const scale = easeOutBack(spawn) * pulse;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);

      // Outer magical halo.
      const haloRadius = size * (0.58 + 0.06 * Math.sin(now / 180));
      const halo = ctx.createRadialGradient(0, 0, size * 0.12, 0, 0, haloRadius);
      halo.addColorStop(0, "rgba(255,224,92,.26)");
      halo.addColorStop(0.45, "rgba(255,92,172,.18)");
      halo.addColorStop(1, "rgba(255,92,172,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
      ctx.fill();

      // Orbiting sparkles.
      for (let i = 0; i < 4; i += 1) {
        const a = now / 520 + i * Math.PI / 2;
        const r = size * 0.48;
        const sx = Math.cos(a) * r;
        const sy = Math.sin(a) * r;
        const sr = size * (i % 2 ? 0.035 : 0.045);
        ctx.shadowColor = i % 2 ? "#ff75c8" : "#ffe06a";
        ctx.shadowBlur = 9;
        ctx.fillStyle = i % 2 ? "#ff9cda" : "#fff0a0";
        drawSparkle(sx, sy, sr);
      }
      ctx.shadowBlur = 0;

      // Doughnut base.
      const outer = size * 0.34;
      const hole = size * 0.115;
      ctx.shadowColor = "rgba(255,205,74,.9)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#c9823d";
      ctx.beginPath();
      ctx.arc(0, size * 0.025, outer, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Frosting.
      ctx.fillStyle = "#ff70b8";
      ctx.beginPath();
      ctx.arc(0, -size * 0.005, outer * 0.90, 0, Math.PI * 2);
      ctx.fill();

      // Frosting highlight.
      ctx.fillStyle = "rgba(255,255,255,.27)";
      ctx.beginPath();
      ctx.ellipse(-size * 0.10, -size * 0.13, size * 0.11, size * 0.05, -0.45, 0, Math.PI * 2);
      ctx.fill();

      // Centre hole.
      ctx.fillStyle = "#5b321b";
      ctx.beginPath();
      ctx.arc(0, size * 0.015, hole, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#071611";
      ctx.beginPath();
      ctx.arc(0, size * 0.01, hole * 0.64, 0, Math.PI * 2);
      ctx.fill();

      // Sprinkles.
      const sprinkles = [
        [-0.18, -0.13, 0.1, "#fff36e"],
        [0.17, -0.15, -0.6, "#71f6ff"],
        [-0.20, 0.09, -0.35, "#9cff78"],
        [0.21, 0.08, 0.4, "#fff"],
        [0.01, -0.22, 0.2, "#8c7cff"],
        [0.03, 0.21, -0.2, "#ffe26e"]
      ];
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(2, size * 0.035);
      for (const [sx, sy, rot, color] of sprinkles) {
        ctx.save();
        ctx.translate(sx * size, sy * size);
        ctx.rotate(rot);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(-size * 0.035, 0);
        ctx.lineTo(size * 0.035, 0);
        ctx.stroke();
        ctx.restore();
      }

      // Floating +5 badge.
      ctx.font = `900 ${Math.max(10, size * 0.25)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff6b6";
      ctx.shadowColor = "#ffb34f";
      ctx.shadowBlur = 8;
      ctx.fillText("+5", 0, -size * 0.53);
      ctx.shadowBlur = 0;

      ctx.restore();
    }
  }

  function detectSpecialEat(now) {
    const eaten = engine.lastEaten;
    if (!eaten || eaten.type !== "special") return;

    const key = `${eaten.createdAt || 0}:${eaten.x}:${eaten.y}`;
    if (key === lastSeenEatenKey) return;
    lastSeenEatenKey = key;

    bursts.push({
      x: eaten.x,
      y: eaten.y,
      startedAt: now,
      user: eaten.user || ""
    });
  }

  function drawBursts(now) {
    const cellW = canvas.width / engine.columns;
    const cellH = canvas.height / engine.rows;
    const size = Math.min(cellW, cellH);

    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      const burst = bursts[i];
      const elapsed = now - burst.startedAt;
      const p = elapsed / 820;
      if (p >= 1) {
        bursts.splice(i, 1);
        continue;
      }

      const cx = (burst.x + 0.5) * cellW;
      const cy = (burst.y + 0.5) * cellH;
      const alpha = 1 - p;

      ctx.save();

      // Expanding reward ring.
      ctx.strokeStyle = `rgba(255,220,90,${0.9 * alpha})`;
      ctx.lineWidth = Math.max(2, size * 0.07 * alpha);
      ctx.beginPath();
      ctx.arc(cx, cy, size * (0.28 + p * 1.3), 0, Math.PI * 2);
      ctx.stroke();

      // Confetti particles.
      const colors = ["#ffe96a", "#ff6fbd", "#6ff7ff", "#93ff76", "#ffffff"];
      for (let j = 0; j < 16; j += 1) {
        const angle = j * (Math.PI * 2 / 16) + 0.21;
        const distance = size * (0.25 + p * (0.9 + (j % 4) * 0.12));
        const px = cx + Math.cos(angle) * distance;
        const py = cy + Math.sin(angle) * distance + p * p * size * 0.5;
        ctx.fillStyle = colors[j % colors.length];
        ctx.globalAlpha = alpha;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle + p * 4);
        ctx.fillRect(-size * 0.035, -size * 0.015, size * 0.07, size * 0.03);
        ctx.restore();
      }

      // Floating score text.
      ctx.globalAlpha = alpha;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `950 ${Math.max(18, size * 0.52)}px system-ui`;
      ctx.fillStyle = "#fff3a1";
      ctx.shadowColor = "#ff8cc9";
      ctx.shadowBlur = 15;
      ctx.fillText("+5", cx, cy - size * (0.4 + p * 1.05));
      ctx.shadowBlur = 0;

      if (burst.user && burst.user !== "JOGO") {
        ctx.font = `800 ${Math.max(9, size * 0.20)}px system-ui`;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(`@${burst.user}`, cx, cy - size * (0.08 + p * 1.05));
      }

      ctx.restore();
    }
  }

  function drawSparkle(x, y, radius) {
    ctx.beginPath();
    ctx.moveTo(x, y - radius * 1.7);
    ctx.lineTo(x + radius * 0.45, y - radius * 0.45);
    ctx.lineTo(x + radius * 1.7, y);
    ctx.lineTo(x + radius * 0.45, y + radius * 0.45);
    ctx.lineTo(x, y + radius * 1.7);
    ctx.lineTo(x - radius * 0.45, y + radius * 0.45);
    ctx.lineTo(x - radius * 1.7, y);
    ctx.lineTo(x - radius * 0.45, y - radius * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const n = Math.max(0, Math.min(1, t));
    return 1 + c3 * Math.pow(n - 1, 3) + c1 * Math.pow(n - 1, 2);
  }

  requestAnimationFrame(loop);
})();
