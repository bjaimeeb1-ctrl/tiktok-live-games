/**
 * TikTokService.js
 * Manages TikTok LIVE connections for multiple streamers.
 *
 * Primary transport: Euler Stream serverless WebSocket API.
 */

import {
  normalizeChat,
  normalizeGift,
  normalizeLike,
  normalizeShare,
} from "../lib/tiktokEventNormalizer.js";
import { getDelay, shouldRetry, sleep } from "../lib/tiktokReconnectPolicy.js";

const EULER_WS_URL = "wss://ws.eulerstream.com";
const EULER_LIVE_VALIDATION_MS = 1000;
const EULER_OFFLINE_RETRY_MS = 15000;
const EULER_OFFLINE_MAX_RETRIES = 20;

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

  async connect(username, io, options = {}) {
    if (this.connections.has(username)) {
      console.log(`[TikTokService] Reusing existing connection for: ${username}`);
      const existing = this.connections.get(username);
      existing.lastActivity = Date.now();
      return true;
    }

    const apiKey = process.env.EULER_API_KEY;
    if (!apiKey) {
      throw new Error(
        'EULER_API_KEY não foi definida. No PowerShell use: $env:EULER_API_KEY="SUA_CHAVE"',
      );
    }

    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket global indisponível. Use Node.js 22 ou superior.");
    }

    console.log(`[TikTokService] Connecting via Euler WebSocket: ${username}`);

    const params = new URLSearchParams({
      uniqueId: username,
      apiKey,
      schemaVersion: "v1",
      "features.bundleEvents": "true",
      "features.rawMessages": "false",
      "features.normalizeUniqueId": "true",
    });

    const ws = new WebSocket(`${EULER_WS_URL}?${params.toString()}`);

    this.connections.set(username, {
      connection: ws,
      lastActivity: Date.now(),
      transport: "euler-websocket",
    });
    this.reconnectState.delete(username);

    let manuallyClosed = false;
    let liveConfirmed = false;

    ws.addEventListener("open", () => {
      this.updateActivity(username);
      console.log(
        `[TikTokService] Euler socket opened for ${username}; validating LIVE...`,
      );
    });

    ws.addEventListener("message", async (event) => {
      this.updateActivity(username);

      try {
        const text = await this._webSocketDataToText(event.data);
        const payload = JSON.parse(text);
        const messages = Array.isArray(payload?.messages)
          ? payload.messages
          : Array.isArray(payload)
            ? payload
            : [payload];

        for (const message of messages) {
          this._relayEulerMessage(username, message, io);
        }
      } catch (error) {
        console.error(
          `[TikTokService] Failed to parse Euler message for ${username}:`,
          error?.message || error,
        );
      }
    });

    ws.addEventListener("error", (event) => {
      const message = event?.message || "Euler WebSocket connection error";
      console.error(`[TikTokService] Euler error for ${username}: ${message}`);
      io.to(username).emit("tiktok_error", {
        message,
        timestamp: Date.now(),
      });
    });

    ws.addEventListener("close", (event) => {
      const code = Number(event?.code || 0);
      const reason = event?.reason || this._closeReason(code);
      console.log(
        `[TikTokService] Euler WebSocket closed for ${username}: code=${code} reason=${reason || "unknown"}`,
      );

      const current = this.connections.get(username);
      if (current?.connection === ws) {
        this.connections.delete(username);
      }

      io.to(username).emit("tiktok_disconnected", {
        code,
        reason,
        timestamp: Date.now(),
      });

      if (
        !manuallyClosed &&
        options.scheduleOnClose !== false &&
        code !== 1000 &&
        code !== 4005 &&
        this.getClientCount(username) > 0
      ) {
        this._scheduleReconnect(username, io, { offline: code === 4404 });
      }
    });

    try {
      await new Promise((resolve, reject) => {
        let validationTimer = null;

        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("Timeout ao conectar ao Euler WebSocket."));
        }, 15000);

        const onOpen = () => {
          validationTimer = setTimeout(() => {
            liveConfirmed = true;
            clearTimeout(timeout);
            cleanup();
            resolve();
          }, EULER_LIVE_VALIDATION_MS);
        };

        const onClose = (event) => {
          clearTimeout(timeout);
          if (validationTimer) clearTimeout(validationTimer);
          cleanup();
          const code = Number(event?.code || 0);
          reject(
            new Error(
              `Euler WebSocket recusou a conexão (${code}): ${event?.reason || this._closeReason(code) || "sem motivo"}`,
            ),
          );
        };

        const cleanup = () => {
          ws.removeEventListener("open", onOpen);
          ws.removeEventListener("close", onClose);
        };

        ws.addEventListener("open", onOpen);
        ws.addEventListener("close", onClose);
      });

      this.updateActivity(username);
      console.log(`[TikTokService] LIVE confirmed via Euler: ${username}`);
      io.to(username).emit("tiktok_connected", {
        roomId: null,
        timestamp: Date.now(),
        transport: "euler-websocket",
      });

      return true;
    } catch (error) {
      manuallyClosed = true;
      const current = this.connections.get(username);
      if (current?.connection === ws) this.connections.delete(username);
      try { ws.close(); } catch {}
      throw error;
    }
  }

  _relayEulerMessage(username, message, io) {
    if (!message || typeof message !== "object") return;

    const method = String(
      message.method || message.type || message.event || message.name || "",
    );
    const data = message.data ?? message.payload ?? message;
    const methodLower = method.toLowerCase();

    if (methodLower.includes("chat")) {
      const payload = normalizeChat(data);
      if (!payload.comment) return;
      io.to(username).emit("tiktok_chat", payload);
      console.log(`[${username}] Chat: ${payload.user.nickname}: ${payload.comment}`);
      return;
    }

    if (methodLower.includes("gift")) {
      const payload = normalizeGift(data);
      io.to(username).emit("tiktok_gift", payload);
      console.log(
        `[${username}] Gift: ${payload.giftName} x${payload.repeatCount} (${payload.giftType}, ${payload.giftValue}💎)`,
      );
      return;
    }

    if (methodLower.includes("like")) {
      const payload = normalizeLike(data);
      io.to(username).emit("tiktok_like", payload);
      console.log(`[${username}] Like: ${payload.likeCount} from ${payload.user.nickname}`);
      return;
    }

    const displayType = String(data?.displayType || data?.display_type || "").toLowerCase();
    const isShare =
      methodLower.includes("share") ||
      (methodLower.includes("social") && displayType.includes("share"));

    if (isShare) {
      const payload = normalizeShare(data);
      io.to(username).emit("tiktok_share", payload);
      console.log(`[${username}] Share from ${payload.user.nickname}`);
    }
  }

  async _webSocketDataToText(data) {
    if (typeof data === "string") return data;
    if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    if (ArrayBuffer.isView(data)) {
      return new TextDecoder().decode(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
    }
    return String(data);
  }

  _closeReason(code) {
    const reasons = {
      1000: "normal closure",
      4005: "LIVE encerrada",
      4006: "timeout sem mensagens",
      4400: "opções inválidas",
      4401: "API key inválida",
      4403: "sem permissão para esta conexão",
      4404: "usuário não está ao vivo",
      4429: "limite de conexões simultâneas atingido",
      4500: "TikTok fechou a conexão",
      4555: "tempo máximo da conexão atingido",
      4556: "falha ao buscar webcast",
      4557: "falha ao buscar dados da sala",
    };
    return reasons[code] || "";
  }

  async _scheduleReconnect(username, io, options = {}) {
    const state = this.reconnectState.get(username);
    if (state?.attempting) return;

    let attempt = 0;
    let offline = Boolean(options.offline);
    this.reconnectState.set(username, { attempting: true, attempt, offline });

    while (
      shouldRetry(
        attempt,
        offline ? { maxRetries: EULER_OFFLINE_MAX_RETRIES } : {},
      )
    ) {
      if (this.getClientCount(username) === 0) break;
      if (this.connections.has(username)) break;

      const delay = offline
        ? EULER_OFFLINE_RETRY_MS
        : getDelay(attempt);

      console.log(
        `[TikTokService] Reconnect attempt ${attempt + 1} for ${username} in ${delay}ms${offline ? " (aguardando LIVE)" : ""}`,
      );
      io.to(username).emit("tiktok_reconnecting", {
        attempt: attempt + 1,
        delayMs: delay,
        offline,
        timestamp: Date.now(),
      });

      await sleep(delay);

      try {
        await this.connect(username, io, { scheduleOnClose: false });
        console.log(
          `[TikTokService] Reconnected to ${username} on attempt ${attempt + 1}`,
        );
        this.reconnectState.delete(username);
        return;
      } catch (error) {
        const message = String(error?.message || error);
        if (message.includes("(4404)") || /not currently live/i.test(message)) {
          offline = true;
        }
        console.error(
          `[TikTokService] Reconnect attempt ${attempt + 1} failed for ${username}: ${message}`,
        );
      }

      attempt += 1;
      this.reconnectState.set(username, { attempting: true, attempt, offline });
    }

    this.reconnectState.delete(username);
  }

  disconnect(username) {
    this.reconnectState.delete(username);

    if (this.connections.has(username)) {
      const { connection } = this.connections.get(username);
      this.connections.delete(username);
      try {
        connection.close(1000, "server disconnect");
      } catch {}
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
      transport: "euler-websocket",
    };
  }
}

export default new TikTokService();
