(() => {
  "use strict";

  const config = window.SNAKE_CONFIG;
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const scoreEl = document.getElementById("score");
  const levelEl = document.getElementById("level");
  const recordEl = document.getElementById("record");
  const eventFeedEl = document.getElementById("eventFeed");
  const leaderboardEl = document.getElementById("leaderboard");
  const statusStrip = document.getElementById("statusStrip");
  const connectionStatus = document.getElementById("connectionStatus");
  const turboBadge = document.getElementById("turboBadge");
  const shieldBadge = document.getElementById("shieldBadge");
  const shieldCount = document.getElementById("shieldCount");
  const gameOverEl = document.getElementById("gameOver");
  const finalScoreEl = document.getElementById("finalScore");
  const recordMessageEl = document.getElementById("recordMessage");

  const query = new URLSearchParams(window.location.search);
  const isTestMode = query.get("test") === "1";
  if (isTestMode) document.body.classList.add("test-mode");

  let record = Number(sessionStorage.getItem("snake-live-record") || 0);
  let lastStepAt = performance.now();
  let restartTimer = null;
  let recentEvents = [];
  const contributors = new Map();
  const giftCounters = new Map();

  const engine = new window.SnakeEngine({
    ...config.board,
    onEvent: handleEngineEvent
  });

  recordEl.textContent = record;

  function handleEngineEvent(event) {
    if (event.type === "ate") {
      const user = event.food.user;
      if (user && user !== "JOGO") {
        addContribution(user, event.food.points);
        pushEvent(`🍏 Comida de @${user} • +${event.food.points}`);
      }
      if (event.score > record) {
        record = event.score;
        sessionStorage.setItem("snake-live-record", String(record));
        recordEl.textContent = record;
      }
    }

    if (event.type === "shield-used") {
      pushEvent("🛡️ Escudo salvou a cobrinha!");
      flashStatus("🛡️ ESCUDO USADO — a partida continua!");
    }

    if (event.type === "game-over") {
      showGameOver(event.score);
    }

    updateHud();
  }

  function gameLoop(now) {
    if (engine.alive && now - lastStepAt >= engine.tickMs) {
      lastStepAt = now;
      engine.step();
    }

    updatePowerBadges();
    render();
    requestAnimationFrame(gameLoop);
  }

  function render() {
    const cols = engine.columns;
    const rows = engine.rows;
    const cellW = canvas.width / cols;
    const cellH = canvas.height / rows;

    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, "#071611");
    bg.addColorStop(1, "#03100d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(83,255,139,.075)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x += 1) {
      ctx.beginPath();
      ctx.moveTo(x * cellW, 0);
      ctx.lineTo(x * cellW, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y += 1) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellH);
      ctx.lineTo(canvas.width, y * cellH);
      ctx.stroke();
    }

    for (const obstacle of engine.obstacles) {
      const x = obstacle.x * cellW;
      const y = obstacle.y * cellH;
      ctx.fillStyle = "#242e34";
      roundRect(x + 3, y + 3, cellW - 6, cellH - 6, 5);
      ctx.strokeStyle = "#59656d";
      ctx.strokeRect(x + 6, y + 6, cellW - 12, cellH - 12);
      ctx.strokeStyle = "rgba(255,190,70,.55)";
      ctx.beginPath();
      ctx.moveTo(x + 5, y + cellH - 6);
      ctx.lineTo(x + cellW - 5, y + 6);
      ctx.stroke();
    }

    for (const food of engine.food) {
      const cx = (food.x + 0.5) * cellW;
      const cy = (food.y + 0.5) * cellH;
      const special = food.type === "special";
      ctx.shadowColor = special ? "#ffd45a" : "#ff3d78";
      ctx.shadowBlur = special ? 17 : 10;
      ctx.fillStyle = special ? "#ffd45a" : "#ff456f";
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(cellW, cellH) * (special ? 0.31 : 0.24), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (special) {
        ctx.fillStyle = "#6b4f00";
        ctx.font = `900 ${Math.max(10, cellW * 0.35)}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("★", cx, cy + 1);
      }
    }

    engine.snake.forEach((part, index) => {
      const x = part.x * cellW;
      const y = part.y * cellH;
      const head = index === 0;
      ctx.shadowColor = head ? "#89ff9d" : "#31e978";
      ctx.shadowBlur = head ? 13 : 6;
      ctx.fillStyle = head ? "#82ff90" : index % 2 ? "#32e878" : "#28d96e";
      roundRect(x + 2.5, y + 2.5, cellW - 5, cellH - 5, head ? 7 : 5);
      ctx.shadowBlur = 0;

      if (head) {
        const eyeSize = Math.max(2, cellW * 0.08);
        const eyeOffset = cellW * 0.19;
        ctx.fillStyle = "#05240f";
        ctx.beginPath();
        ctx.arc(
          x + cellW / 2 + eyeOffset * engine.direction.y,
          y + cellH / 2 - eyeOffset * engine.direction.x,
          eyeSize,
          0,
          Math.PI * 2
        );
        ctx.arc(
          x + cellW / 2 - eyeOffset * engine.direction.y,
          y + cellH / 2 + eyeOffset * engine.direction.x,
          eyeSize,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    });
  }

  function roundRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
  }

  function updateHud() {
    scoreEl.textContent = engine.score;
    levelEl.textContent = engine.level;
    recordEl.textContent = record;
    shieldCount.textContent = engine.shields;
  }

  function updatePowerBadges() {
    turboBadge.classList.toggle("show", Date.now() < engine.turboUntil);
    shieldBadge.classList.toggle("show", engine.shields > 0);
    shieldCount.textContent = engine.shields;
  }

  function addContribution(user, points) {
    const current = contributors.get(user) || 0;
    contributors.set(user, current + Math.max(1, points));
    renderLeaderboard();
  }

  function renderLeaderboard() {
    const ranking = [...contributors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    leaderboardEl.innerHTML = ranking.length
      ? ranking
          .map(
            ([user, value], index) =>
              `<div class="rank"><span class="pos">${index + 1}</span><span>@${escapeHtml(user)}</span><span class="score">${value}</span></div>`
          )
          .join("")
      : `<div class="event">Aguardando presentes...</div>`;
  }

  function pushEvent(text) {
    recentEvents.unshift(text);
    recentEvents = recentEvents.slice(0, 5);
    eventFeedEl.innerHTML = recentEvents
      .map((item) => `<div class="event">${escapeHtml(item)}</div>`)
      .join("");
  }

  function flashStatus(text) {
    statusStrip.textContent = text;
    clearTimeout(flashStatus.timer);
    flashStatus.timer = setTimeout(() => {
      statusStrip.textContent = "🌹 Presentes colocam comida e mudam a partida!";
    }, 2600);
  }

  function showGameOver(score) {
    finalScoreEl.textContent = score;
    const newRecord = score >= record && score > 0;
    recordMessageEl.textContent = newRecord ? "🏆 Novo recorde da LIVE!" : `Recorde atual: ${record}`;
    gameOverEl.classList.add("show");
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      engine.reset();
      lastStepAt = performance.now();
      gameOverEl.classList.remove("show");
      pushEvent("🐍 Nova partida começou!");
    }, config.board.restartDelayMs);
  }

  function processAction(action, user = "viewer") {
    const safeUser = normalizeUser(user);
    if (!engine.alive && action.action !== "shield") return;

    if (action.action === "food") {
      const created = engine.spawnFoods(action.amount || 1, {
        type: "normal",
        points: 1,
        grow: 1,
        user: safeUser
      });
      addContribution(safeUser, created);
      pushEvent(`🌹 @${safeUser} colocou ${created} comida${created === 1 ? "" : "s"}`);
      flashStatus(`🌹 @${safeUser} adicionou comida!`);
    }

    if (action.action === "specialFood") {
      const created = engine.spawnFoods(action.amount || 1, {
        type: "special",
        points: 5,
        grow: 2,
        user: safeUser
      });
      addContribution(safeUser, created * 2);
      pushEvent(`🍩 @${safeUser} criou comida especial`);
      flashStatus(`🍩 COMIDA ESPECIAL de @${safeUser}!`);
    }

    if (action.action === "turbo") {
      engine.setTurbo(action.durationMs || 5000);
      addContribution(safeUser, 3);
      pushEvent(`⚡ @${safeUser} ativou TURBO`);
      flashStatus(`⚡ TURBO ativado por @${safeUser}!`);
    }

    if (action.action === "bomb") {
      const amount = Math.max(1, Math.min(4, action.amount || 1));
      let created = 0;
      for (let i = 0; i < amount; i += 1) if (engine.addObstacle()) created += 1;
      addContribution(safeUser, created * 2);
      pushEvent(`💣 @${safeUser} colocou ${created} obstáculo${created === 1 ? "" : "s"}`);
      flashStatus(`💣 Cuidado! @${safeUser} colocou uma bomba.`);
    }

    if (action.action === "shield") {
      engine.addShield(action.amount || 1);
      addContribution(safeUser, 4);
      pushEvent(`🛡️ @${safeUser} deu um ESCUDO`);
      flashStatus(`🛡️ ESCUDO enviado por @${safeUser}!`);
    }

    updateHud();
  }

  function processGift(data) {
    const user = data?.user?.uniqueId || data?.user?.nickname || "viewer";
    const giftName = String(data?.giftName || "").trim().toLowerCase();
    const giftKey = giftName.replace(/\s+/g, "");
    const mapping =
      config.gifts[giftName] ||
      config.gifts[giftKey] ||
      config.fallbackByTier[data?.giftType] ||
      config.fallbackByTier.small;

    // The current platform normalizer does not expose repeatEnd.
    // For streak-style gifts we only apply the incremental delta to avoid x1+x2+x3 overcounting.
    const streakKey = `${normalizeUser(user)}:${data?.giftId || giftKey}`;
    const now = Date.now();
    const previous = giftCounters.get(streakKey);
    let repeatDelta = 1;
    const repeatCount = Math.max(1, Number(data?.repeatCount) || 1);

    if (previous && now - previous.at < 1600 && repeatCount > previous.count) {
      repeatDelta = repeatCount - previous.count;
    } else if (previous && now - previous.at < 500 && repeatCount === previous.count) {
      repeatDelta = 0;
    }
    giftCounters.set(streakKey, { count: repeatCount, at: now });

    if (repeatDelta <= 0) return;

    const action = { ...mapping };
    if (action.amount) action.amount *= repeatDelta;
    processAction(action, user);
  }

  function normalizeUser(value) {
    return (
      String(value || "viewer")
        .replace(/^@/, "")
        .replace(/[<>]/g, "")
        .slice(0, 22) || "viewer"
    );
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function wireTikTok() {
    if (!window.TikTokBridge) return;

    window.TikTokBridge.on("connected", () => {
      connectionStatus.textContent = "● TIKTOK CONECTADO";
      connectionStatus.classList.remove("offline");
      connectionStatus.classList.add("online");
      pushEvent("✅ TikTok LIVE conectada");
    });

    window.TikTokBridge.on("disconnected", () => {
      connectionStatus.textContent = "TIKTOK DESCONECTADO";
      connectionStatus.classList.remove("online");
      connectionStatus.classList.add("offline");
    });

    window.TikTokBridge.on("reconnecting", () => {
      connectionStatus.textContent = "RECONECTANDO...";
      connectionStatus.classList.remove("online");
      connectionStatus.classList.add("offline");
    });

    window.TikTokBridge.on("gift", processGift);

    window.TikTokBridge.on("chat", (data) => {
      const comment = String(data?.comment || "").toLowerCase();
      if (comment.includes("cobrinha") || comment.includes("snake")) {
        const user = data?.user?.uniqueId || data?.user?.nickname || "viewer";
        pushEvent(`💬 @${normalizeUser(user)}: ${comment.slice(0, 34)}`);
      }
    });
  }

  function setupTestPanel() {
    if (!isTestMode) return;
    const buttons = document.getElementById("testButtons");
    const userInput = document.getElementById("testUser");

    for (const item of config.testActions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => processAction(item, userInput.value));
      buttons.appendChild(button);
    }

    document.getElementById("testReset").addEventListener("click", () => {
      clearTimeout(restartTimer);
      engine.reset();
      lastStepAt = performance.now();
      gameOverEl.classList.remove("show");
      pushEvent("↻ Partida reiniciada");
    });
  }

  renderLeaderboard();
  pushEvent("🐍 Cobrinha pronta. Aguardando a LIVE...");
  updateHud();
  wireTikTok();
  setupTestPanel();
  requestAnimationFrame(gameLoop);

  window.SnakeLiveTest = {
    action: processAction,
    reset: () => engine.reset(),
    engine
  };
})();
