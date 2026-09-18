/**
 * server.js
 * Main entry point - Express + Socket.io Server
 *
 * MULTI-TENANT ARCHITECTURE:
 * - Each streamer = 1 isolated Socket.io Room
 * - Room ID = TikTok username
 * - Data isolation: Streamer A cannot see Streamer B's data
 *
 * @module server
 */

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import tiktokService from "./services/TikTokService.js";

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==========================================
// SERVER INITIALIZATION
// ==========================================
const app = express();
const server = createServer(app);

// Socket.io with CORS enabled for development
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

const EULER_API_BASE = "https://api.eulerstream.com";
const GIFT_CATALOG_CACHE_MS = 15 * 60 * 1000;
let giftCatalogCache = { at: 0, gifts: [] };

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function parseMaybeJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeCatalogGift(row = {}) {
  const raw = parseMaybeJson(row.raw);
  const nested = raw.gift || raw.data || raw;

  const id = String(
    firstDefined(
      row.id,
      row.giftId,
      row.gift_id,
      nested.id,
      nested.giftId,
      nested.gift_id,
      ""
    )
  );

  const name = String(
    firstDefined(
      row.name,
      row.giftName,
      row.gift_name,
      row.displayName,
      row.display_name,
      nested.name,
      nested.giftName,
      nested.gift_name,
      ""
    )
  ).trim();

  const costValue = Number(
    firstDefined(
      row.diamondCount,
      row.diamond_count,
      row.coinPrice,
      row.coin_price,
      row.price,
      nested.diamondCount,
      nested.diamond_count,
      nested.coinPrice,
      nested.coin_price,
      nested.price,
      0
    )
  );

  const image = String(
    firstDefined(
      row.imageUrl,
      row.image_url,
      row.iconUrl,
      row.icon_url,
      row.pictureUrl,
      row.picture_url,
      nested.imageUrl,
      nested.image_url,
      nested.iconUrl,
      nested.icon_url,
      nested.pictureUrl,
      nested.picture_url,
      nested.image?.urlList?.[0],
      nested.image?.url_list?.[0],
      nested.icon?.urlList?.[0],
      nested.icon?.url_list?.[0],
      ""
    )
  );

  if (!name) return null;

  return {
    id,
    name,
    cost: Number.isFinite(costValue) ? costValue : 0,
    image,
  };
}

async function fetchEulerGiftCatalog() {
  const apiKey = process.env.EULER_API_KEY;
  if (!apiKey) {
    throw new Error("EULER_API_KEY is not configured");
  }

  if (
    giftCatalogCache.gifts.length &&
    Date.now() - giftCatalogCache.at < GIFT_CATALOG_CACHE_MS
  ) {
    return giftCatalogCache.gifts;
  }

  const all = [];
  let totalPages = 1;

  for (let pageNumber = 1; pageNumber <= totalPages && pageNumber <= 20; pageNumber += 1) {
    const url = new URL("/webcast/gifts/catalog", EULER_API_BASE);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("pageNumber", String(pageNumber));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let response;
    try {
      response = await fetch(url, {
        headers: {
          "X-Api-Key": apiKey,
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const message =
        payload?.message ||
        `Euler gift catalog request failed with HTTP ${response.status}`;
      throw new Error(message);
    }

    const rows = Array.isArray(payload?.gifts)
      ? payload.gifts
      : Array.isArray(payload?.data?.gifts)
        ? payload.data.gifts
        : [];

    for (const row of rows) {
      const gift = normalizeCatalogGift(row);
      if (gift) all.push(gift);
    }

    totalPages = Math.max(
      1,
      Number(payload?.totalPages || payload?.total_pages || 1) || 1
    );

    if (!rows.length) break;
  }

  const seen = new Set();
  const gifts = all
    .filter((gift) => {
      const key = gift.id || gift.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const costDiff = (a.cost || 0) - (b.cost || 0);
      return costDiff || a.name.localeCompare(b.name, "pt-BR");
    });

  giftCatalogCache = { at: Date.now(), gifts };
  return gifts;
}

// ==========================================
// MIDDLEWARE & STATIC FILES
// ==========================================

// Serve static files from public directory
app.use(express.static(join(__dirname, "../public")));

// Parse JSON body
app.use(express.json());

// ==========================================
// API ROUTES
// ==========================================

/**
 * Health check endpoint
 * @route GET /api/health
 */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    stats: tiktokService.getStats(),
  });
});

/**
 * Get connection statistics
 * @route GET /api/stats
 */
app.get("/api/stats", (req, res) => {
  res.json(tiktokService.getStats());
});

/**
 * Proxy the Euler Stream TikTok LIVE gift catalog.
 * Keeps the Euler API key server-side and gives the game a simple normalized list.
 * @route GET /api/gifts/catalog
 */
app.get("/api/gifts/catalog", async (req, res) => {
  try {
    const gifts = await fetchEulerGiftCatalog();
    res.json({
      status: "ok",
      count: gifts.length,
      gifts,
      cachedAt: giftCatalogCache.at,
    });
  } catch (error) {
    console.error(`[GiftCatalog] ${error.message}`);
    res.status(502).json({
      status: "error",
      message: error.message,
      gifts: [],
    });
  }
});

// ==========================================
// SOCKET.IO - REALTIME CONNECTION HANDLING
// ==========================================

io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  /**
   * JOIN ROOM HANDLER
   *
   * IMPORTANT - DATA ISOLATION:
   * - Each client joins a room based on streamer's username
   * - Client only receives events from their subscribed streamer
   * - Ensures data isolation between different streamers
   */
  socket.on("join-room", async (username) => {
    // Validate username
    if (!username || typeof username !== "string") {
      socket.emit("error", { message: "Invalid username" });
      return;
    }

    // Normalize username (lowercase, trimmed)
    const normalizedUsername = username.toLowerCase().trim();

    // Store username in socket instance for disconnect handling
    socket.tiktokUsername = normalizedUsername;

    // Join Socket.io room
    socket.join(normalizedUsername);
    console.log(`[Socket] ${socket.id} joined room: ${normalizedUsername}`);

    // Update room client tracking
    tiktokService.addClientToRoom(normalizedUsername);

    // Connect to TikTok Live (reuses existing connection if available)
    try {
      const connected = await tiktokService.connect(normalizedUsername, io);
      if (connected) {
        socket.emit("room-joined", {
          room: normalizedUsername,
          message: `Joined room: ${normalizedUsername}`,
        });
      } else {
        socket.emit("connection-error", {
          message: `Cannot connect to ${normalizedUsername}'s live. Make sure they are currently streaming!`,
        });
      }
    } catch (error) {
      console.error(`[Socket] Error connecting to TikTok: ${error.message}`);
      socket.emit("connection-error", {
        message: error.message,
      });
    }
  });

  /**
   * LEAVE ROOM HANDLER
   */
  socket.on("leave-room", (username) => {
    if (username) {
      const normalizedUsername = username.toLowerCase().trim();
      socket.leave(normalizedUsername);
      tiktokService.removeClientFromRoom(normalizedUsername);
      console.log(`[Socket] ${socket.id} left room: ${normalizedUsername}`);
    }
  });

  /**
   * DISCONNECT HANDLER
   *
   * When client disconnects, update room count.
   * If room is empty for too long, TikTokService will auto-disconnect.
   */
  socket.on("disconnect", () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);

    if (socket.tiktokUsername) {
      tiktokService.removeClientFromRoom(socket.tiktokUsername);
    }
  });

  /**
   * Debug: Ping-pong for connection testing
   */
  socket.on("ping", () => {
    socket.emit("pong", { timestamp: Date.now() });
  });
});

// ==========================================
// START SERVER
// ==========================================

server.listen(PORT, () => {
  console.log(`
    TikTok Live Games - Open Source Platform
    Server running at: → http://localhost:${PORT}
    `);
});

// Graceful shutdown handler
process.on("SIGINT", () => {
  console.log("\n[Server] Shutting down...");

  // Disconnect all TikTok connections
  const stats = tiktokService.getStats();
  stats.connections.forEach((username) => {
    tiktokService.disconnect(username);
  });

  server.close(() => {
    console.log("[Server] Goodbye!");
    process.exit(0);
  });
});
