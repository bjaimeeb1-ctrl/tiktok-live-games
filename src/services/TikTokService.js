/**
 * TikTokService.js
 * Manages TikTok Live connections for multiple streamers (Multi-tenant)
 */

import { TikTokLiveConnection, WebcastEvent, ControlEvent } from "tiktok-live-connector";
import {
  normalizeChat,
  normalizeGift,
  normalizeLike,
  normalizeShare,
} from "../lib/tiktokEventNormalizer.js";
import { getDelay, shouldRetry, sleep } from "../lib/tiktokReconnectPolicy.js";

class TikTokService {
  constructor() {
    if (TikTokService.instance) return TikTokService.instance;
    TikTokService.instance = this;

    this.connections = new Map();
    this.roomClients = new Map();
    this.reconnectState = new Map();

    this.cleanupInterval = setInterval(
      () => this.checkInactiveConnections(),
      60000,
    );
  }

  async connect(username, io) {
    if (this.connections.has(username)) {
      console.log(`[TikTokService] Reusing existing connection for: ${username}`);
      const existing = this.connections.get(username);
      existing.lastActivity = Date.now();
      return true;
    }

    console.log(`[TikTokService] Creating new connection for: ${username}`);

    const connection = new TikTokLiveConnection(username, {
      processInitialData: true,
      enableExtendedGiftInfo: true,
    });

    this.connections.set(username, {
      connection,
      lastActivity: Date.now(),
    });

    this.reconnectState.delete(username);

    connection.on(WebcastEvent.CHAT, (data) => {
      this.updateActivity(username);
      const payload = normalizeChat(data);
      io.to(username).emit("tiktok_chat", payload);
      console.log(`[${username}] Chat: ${payload.user.nickname}: ${payload.comment}`);
    });

    connection.on(WebcastEvent.LIKE, (data) => {
      this.updateActivity(username);
      const payload = normalizeLike(data);
      io.to(username).emit("tiktok_like", payload);
      console.log(`[${username}] Like: ${payload.likeCount} from ${payload.user.nickname}`);
    });

    connection.on(WebcastEvent.SOCIAL, (data) => {
      if (data.displayType === "pm_mt_msg_viewer_share") {
        this.updateActivity(username);
        const payload = normalizeShare(data);
        io.to(username).emit("tiktok_share", payload);
        console.log(`[${username}] Share from ${payload.user.nickname}`);
      }
    });

    connection.on(WebcastEvent.GIFT, (data) => {
      this.updateActivity(username);
      const payload = normalizeGift(data);
      io.to(username).emit("tiktok_gift", payload);
      console.log(
        `[${username}] Gift: ${payload.giftName} x${payload.repeatCount} (${payload.giftType}, ${payload.giftValue}💎)`,
      );
    });

    connection.on(ControlEvent.CONNECTED, (state) => {
      console.log(`[TikTokService] Connected to live: ${username}`);
      io.to(username).emit("tiktok_connected", {
        roomId: state?.roomId || connection.state?.roomId || null,
        timestamp: Date.now(),
      });
    });

    connection.on(ControlEvent.DISCONNECTED, () => {
      console.log(`[TikTokService] Disconnected from: ${username}`);
      this.connections.delete(username);
      io.to(username).emit("tiktok_disconnected", {
        timestamp: Date.now(),
      });

      const clientCount = this.getClientCount(username);
      if (clientCount > 0) {
        this._scheduleReconnect(username, io);
      }
    });

    connection.on(ControlEvent.ERROR, (err) => {
      const message = err?.message || String(err || "Unknown TikTok error");
      console.error(`[TikTokService] Error for ${username}:`, message);
      io.to(username).emit("tiktok_error", {
        message,
        timestamp: Date.now(),
      });
    });

    try {
      const state = await connection.connect();
      console.log(
        `[TikTokService] connect() resolved for ${username} (roomId: ${state?.roomId || "unknown"})`,
      );
      return true;
    } catch (error) {
      this.connections.delete(username);
      const message = error?.message || String(error || "Unknown TikTok connection error");
      console.error(`[TikTokService] Cannot connect to ${username}:`, message);
      throw new Error(message);
    }
  }

  async _scheduleReconnect(username, io) {
    const state = this.reconnectState.get(username);
    if (state?.attempting) return;

    let attempt = 0;
    this.reconnectState.set(username, { attempting: true, attempt });

    while (shouldRetry(attempt)) {
      if (this.getClientCount(username) === 0) break;
      if (this.connections.has(username)) break;

      const delay = getDelay(attempt);
      console.log(
        `[TikTokService] Reconnect attempt ${attempt + 1} for ${username} in ${delay}ms`,
      );
      io.to(username).emit("tiktok_reconnecting", {
        attempt: attempt + 1,
        delayMs: delay,
        timestamp: Date.now(),
      });

      await sleep(delay);

      try {
        await this.connect(username, io);
        console.log(
          `[TikTokService] Reconnected to ${username} on attempt ${attempt + 1}`,
        );
        this.reconnectState.delete(username);
        return;
      } catch (error) {
        console.error(
          `[TikTokService] Reconnect attempt ${attempt + 1} failed for ${username}: ${error?.message || error}`,
        );
      }

      attempt++;
      this.reconnectState.set(username, { attempting: true, attempt });
    }

    console.error(
      `[TikTokService] Reconnect failed for ${username} after ${attempt} attempts`,
    );
    io.to(username).emit("tiktok_error", {
      message: `Reconnect failed after ${attempt} attempts. Streamer may have ended the live.`,
      timestamp: Date.now(),
    });
    this.reconnectState.delete(username);
  }

  disconnect(username) {
    this.reconnectState.delete(username);

    if (this.connections.has(username)) {
      const { connection } = this.connections.get(username);
      try {
        const result = connection.disconnect();
        if (result?.catch) result.catch(() => {});
      } catch (_) {
        // Ignore disconnect errors.
      }
      this.connections.delete(username);
      console.log(`[TikTokService] Disconnected: ${username}`);
    }
  }

  updateActivity(username) {
    if (this.connections.has(username)) {
      this.connections.get(username).lastActivity = Date.now();
    }
  }

  addClientToRoom(username) {
    const count = this.roomClients.get(username) || 0;
    this.roomClients.set(username, count + 1);
    console.log(`[TikTokService] Room ${username}: ${count + 1} clients`);
  }

  removeClientFromRoom(username) {
    const count = this.roomClients.get(username) || 0;
    if (count > 0) {
      this.roomClients.set(username, count - 1);
      console.log(`[TikTokService] Room ${username}: ${count - 1} clients`);
    }
  }

  getClientCount(username) {
    return this.roomClients.get(username) || 0;
  }

  checkInactiveConnections() {
    const TIMEOUT = 5 * 60 * 1000;
    const now = Date.now();

    for (const [username, data] of this.connections.entries()) {
      const clientCount = this.getClientCount(username);
      const timeSinceActivity = now - data.lastActivity;

      if (clientCount === 0 && timeSinceActivity > TIMEOUT) {
        console.log(
          `[TikTokService] Auto-disconnect ${username} (inactive ${Math.round(
            timeSinceActivity / 1000,
          )}s, 0 clients)`,
        );
        this.disconnect(username);
      }
    }
  }

  getStats() {
    return {
      activeConnections: this.connections.size,
      connections: Array.from(this.connections.keys()),
      rooms: Object.fromEntries(this.roomClients),
    };
  }
}

export default new TikTokService();
