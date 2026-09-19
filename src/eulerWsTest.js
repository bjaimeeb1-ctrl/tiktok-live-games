const username = process.argv[2] || "jaimeebsantos";
const apiKey = process.env.EULER_API_KEY;

if (!apiKey) {
  console.error("[Euler WS] EULER_API_KEY não foi definido.");
  console.error('PowerShell: $env:EULER_API_KEY="SUA_CHAVE"');
  process.exit(1);
}

if (typeof WebSocket === "undefined") {
  console.error("[Euler WS] Este Node.js não possui WebSocket global. Use Node 22+.");
  process.exit(1);
}

const params = new URLSearchParams({
  uniqueId: username,
  apiKey,
  schemaVersion: "v1",
  "features.bundleEvents": "true",
  "features.rawMessages": "false",
  "features.normalizeUniqueId": "true"
});

const url = `wss://ws.eulerstream.com?${params.toString()}`;
const ws = new WebSocket(url);

console.log(`[Euler WS] Conectando à LIVE de @${username}...`);
console.log("[Euler WS] A chave não será exibida no terminal.");

ws.addEventListener("open", () => {
  console.log(`[Euler WS] ✅ WebSocket aberto para @${username}`);
  console.log("[Euler WS] Agora mande um comentário e alguns likes usando outra conta.");
});

ws.addEventListener("message", async (event) => {
  try {
    let text;
    if (typeof event.data === "string") {
      text = event.data;
    } else if (event.data instanceof Blob) {
      text = await event.data.text();
    } else if (event.data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(event.data);
    } else {
      text = String(event.data);
    }

    const payload = JSON.parse(text);
    const messages = Array.isArray(payload?.messages)
      ? payload.messages
      : Array.isArray(payload)
        ? payload
        : [payload];

    for (const msg of messages) {
      const method = msg?.method || msg?.type || msg?.event || msg?.name || "evento-desconhecido";
      const data = msg?.data ?? msg?.payload ?? msg;

      if (/chat/i.test(method)) {
        const user = data?.user?.uniqueId || data?.user?.nickname || data?.uniqueId || "viewer";
        const comment = data?.comment || data?.content || data?.text || "";
        console.log(`[CHAT] @${user}: ${comment}`);
      } else if (/gift/i.test(method)) {
        const user = data?.user?.uniqueId || data?.user?.nickname || data?.uniqueId || "viewer";
        const giftName = data?.gift?.name || data?.giftName || data?.gift?.giftName || "presente";
        console.log(`[GIFT] @${user}: ${giftName}`);
      } else if (/like/i.test(method)) {
        const user = data?.user?.uniqueId || data?.user?.nickname || data?.uniqueId || "viewer";
        const count = data?.likeCount || data?.count || data?.like_count || 0;
        console.log(`[LIKE] @${user}: +${count}`);
      } else {
        console.log(`[EVENTO] ${method}`);
      }
    }
  } catch (error) {
    console.log("[Euler WS] Mensagem recebida, mas não foi possível interpretar como JSON:");
    console.log(String(error?.message || error));
  }
});

ws.addEventListener("error", (event) => {
  console.error("[Euler WS] ❌ Erro no WebSocket.", event?.message || "");
});

ws.addEventListener("close", (event) => {
  console.log(`[Euler WS] Conexão encerrada. code=${event.code} reason=${event.reason || "(sem motivo)"}`);
  if (event.code === 4401) console.log("[Euler WS] Chave de API inválida ou ausente.");
  if (event.code === 4403) console.log("[Euler WS] Seu plano não tem permissão para esta conexão.");
  if (event.code === 4404) console.log(`[Euler WS] @${username} não foi detectado como AO VIVO.`);
  if (event.code === 4429) console.log("[Euler WS] Limite de conexões simultâneas atingido.");
});

process.on("SIGINT", () => {
  console.log("\n[Euler WS] Encerrando teste...");
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(0), 250);
});
