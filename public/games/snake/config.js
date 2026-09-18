window.SNAKE_CONFIG = {
  board: {
    columns: 22,
    rows: 30,
    normalTickMs: 155,
    turboTickMs: 88,
    restartDelayMs: 3200,
    maxFood: 28,
    maxObstacles: 18,
    maxBombs: 8,
    bombArmMs: 1600,
    bombExplosionMs: 520,
    bombBurnedMs: 7000,
    bombBlastRadius: 1
  },

  audio: {
    turnKeyEnabled: true,
    turnKeyVolume: 0.26
  },

  gifts: {
    // Names are matched case-insensitively. The generic gift tier is used as fallback.
    rose: { action: "food", amount: 1, label: "Rosa", icon: "🌹" },
    heart: { action: "food", amount: 3, label: "Coração", icon: "❤️" },
    gg: { action: "bomb", amount: 1, label: "GG", icon: "💣" },
    doughnut: { action: "specialFood", amount: 1, label: "Rosquinha", icon: "🍩" },
    donut: { action: "specialFood", amount: 1, label: "Rosquinha", icon: "🍩" },
    tiktok: { action: "turbo", durationMs: 5000, label: "TikTok", icon: "⚡" },
    crown: { action: "shield", amount: 1, label: "Coroa", icon: "👑" }
  },

  fallbackByTier: {
    small: { action: "food", amount: 1, icon: "🎁" },
    medium: { action: "specialFood", amount: 1, icon: "🎁" },
    large: { action: "shield", amount: 1, icon: "🎁" }
  },

  testActions: [
    { label: "🌹 Rosa", action: "food", amount: 1 },
    { label: "🍩 Rosquinha", action: "specialFood", amount: 1 },
    { label: "⚡ Turbo", action: "turbo", durationMs: 5000 },
    { label: "💣 Bomba", action: "bomb", amount: 1 },
    { label: "🛡️ Escudo", action: "shield", amount: 1 }
  ]
};