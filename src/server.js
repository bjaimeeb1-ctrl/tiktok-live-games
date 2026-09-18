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

function extractRegionalGiftRows(payload = {}) {
  const candidates = [
    payload?.gifts,
    payload?.gift_list,
    payload?.giftList,
    payload?.data?.gifts,
    payload?.data?.gift_list,
    payload?.data?.giftList,
    payload?.data?.gift_data,
    payload?.data?.giftData,
  ];

  return candidates.find(Array.isArray) || [];
}

async function fetchJson(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }

    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
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

  // Important: this is the regional TikTok gift endpoint, NOT Euler's global catalog.
  // The requested region is locked to Brazil so only gifts TikTok exposes in BR
  // are offered by the Snake gift configurator.
  const regionalEndpoint = new URL("/webcast/gifts", EULER_API_BASE);
  regionalEndpoint.searchParams.set("region", "BR");
  regionalEndpoint.searchParams.set("webcast_language", "en");
  regionalEndpoint.searchParams.set("redirect", "false");

  const headers = {
    "X-Api-Key": apiKey,
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  const { response: signedResponse, payload: signedPayload } = await fetchJson(
    regionalEndpoint,
    { headers }
  );

  if (!signedResponse.ok) {
    const details = JSON.stringify(signedPayload || {});
    const message =
      signedPayload?.message ||
      `Euler Brazil gifts request failed with HTTP ${signedResponse.status}`;
    throw new Error(`${message} | response=${details}`);
  }

  // Euler returns the signed TikTok URL for the selected region.
  // Fetch it server-side so the API key never reaches the browser.
  const signedUrl = signedPayload?.url;
  let regionalPayload = signedPayload;

  if (signedUrl) {
    const { response: tikTokResponse, payload: tikTokPayload } = await fetchJson(
      signedUrl,
      {
        headers: {
          Accept: "application/json",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
        },
      }
    );

    if (!tikTokResponse.ok) {
      throw new Error(
        `TikTok Brazil gift list request failed with HTTP ${tikTokResponse.status}`
      );
    }

    regionalPayload = tikTokPayload;
  }

  const rows = extractRegionalGiftRows(regionalPayload);
  if (!rows.length) {
    throw new Error("TikTok returned no gifts for region BR");
  }

  const seen = new Set();
  const gifts = rows
    .map(normalizeCatalogGift)
    .filter(Boolean)
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

  if (!gifts.length) {
    throw new Error("Could not normalize TikTok gifts for region BR");
  }

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
      region: "BR",
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
