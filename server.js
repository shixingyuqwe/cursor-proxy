const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

// Load config
const CONFIG_PATH = path.join(__dirname, "config.json");
let config = { apiBase: "https://nagara.top", apiKey: "", model: "claude-opus-4-6", port: 34567 };
try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) }; } catch {}

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

let requestCount = 0;
const wsClients = new Set();

wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.send(JSON.stringify({ type: "config", config: { apiBase: config.apiBase, apiKey: config.apiKey ? "***" + config.apiKey.slice(-6) : "", model: config.model, port: config.port }, cursorUrl: `(fill in your ngrok URL)/v1` }));
  ws.on("close", () => wsClients.delete(ws));
});

function broadcast(text) {
  const msg = JSON.stringify({ type: "log", text });
  for (const ws of wsClients) { try { ws.send(msg); } catch {} }
}

function log(id, ...args) {
  const text = `[${new Date().toLocaleTimeString()}] [#${id}] ${args.join(" ")}`;
  console.log(text);
  broadcast(text);
}

// Admin UI
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.post("/admin/config", (req, res) => {
  try {
    const newConfig = req.body;
    config.apiBase = newConfig.apiBase || config.apiBase;
    config.apiKey = newConfig.apiKey || config.apiKey;
    config.model = newConfig.model || config.model;
    config.port = newConfig.port || config.port;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    broadcast("Configuration updated and saved.");
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Dedup
const recentRequests = new Map();
const DEDUP_WINDOW = 8000;

function getRequestKey(body) {
  const msgs = body?.messages;
  if (!msgs || !msgs.length) return null;
  const lastMsg = msgs[msgs.length - 1];
  const content = typeof lastMsg.content === "string" ? lastMsg.content
    : Array.isArray(lastMsg.content) ? JSON.stringify(lastMsg.content) : "";
  return `${msgs.length}:${content.slice(0, 200)}`;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of recentRequests) {
    if (now - val.timestamp > 30000) recentRequests.delete(key);
  }
}, 10000);

// Convert Cursor tools to Anthropic format
function convertTools(tools) {
  if (!tools || !Array.isArray(tools)) return undefined;
  return tools.map(tool => {
    if (tool.name && tool.input_schema) return tool;
    if (tool.name && tool.name.length > 0) {
      return { name: tool.name, description: tool.description || "", input_schema: tool.parameters || tool.input_schema || { type: "object", properties: {} } };
    }
    if (tool.type === "function" && tool.function) {
      return { name: tool.function.name, description: tool.function.description || "", input_schema: tool.function.parameters || { type: "object", properties: {} } };
    }
    return null;
  }).filter(Boolean);
}

// Ensure messages are in Anthropic format
function convertMessages(messages) {
  if (!messages || !Array.isArray(messages)) return [];
  const result = [];
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) delete block.cache_control;
    }
    if (msg.role === "tool" && msg.tool_call_id) {
      result.push({ role: "user", content: [{ type: "tool_result", tool_use_id: msg.tool_call_id, content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content || "") }] });
      continue;
    }
    if (msg.role === "assistant" && msg.tool_calls && Array.isArray(msg.tool_calls)) {
      const content = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      for (const tc of msg.tool_calls) {
        let input = {};
        try { input = JSON.parse(tc.function?.arguments || "{}"); } catch {}
        content.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input });
      }
      result.push({ role: "assistant", content });
      continue;
    }
    result.push({ role: msg.role, content: msg.content });
  }
  const merged = [];
  for (const msg of result) {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      const prev = merged[merged.length - 1];
      const prevContent = Array.isArray(prev.content) ? prev.content : typeof prev.content === "string" ? [{ type: "text", text: prev.content }] : [prev.content];
      const curContent = Array.isArray(msg.content) ? msg.content : typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : [msg.content];
      prev.content = [...prevContent, ...curContent];
    } else {
      merged.push({ ...msg });
    }
  }
  if (merged.length > 0 && merged[0].role !== "user") merged.unshift({ role: "user", content: "Hello" });
  return merged;
}

// Direct Anthropic passthrough
app.post("/v1/messages", async (req, res) => {
  const id = ++requestCount;
  log(id, `ANTHROPIC /v1/messages | model: ${req.body?.model} | stream: ${req.body?.stream} | msgs: ${req.body?.messages?.length || 0}`);
  const body = { ...req.body, model: config.model };
  try {
    const response = await axios.post(`${config.apiBase}/v1/messages`, body, {
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "anthropic-version": req.headers["anthropic-version"] || "2023-06-01" },
      responseType: body.stream ? "stream" : "json", timeout: 120000
    });
    log(id, `Response: ${response.status}`);
    if (body.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      response.data.pipe(res);
      response.data.on("end", () => log(id, "Stream ended"));
      response.data.on("error", (e) => { log(id, `Stream error: ${e.message}`); res.end(); });
    } else {
      res.json(response.data);
    }
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data;
    if (data && typeof data.pipe === "function") {
      let errBody = ""; data.on("data", (chunk) => errBody += chunk);
      data.on("end", () => { log(id, `Error ${status}: ${errBody.slice(0, 500)}`); res.status(status).end(errBody); });
    } else {
      const errMsg = data ? JSON.stringify(data) : error.message;
      log(id, `Error ${status}: ${errMsg.slice(0, 500)}`);
      res.status(status).json(data || { error: { message: error.message } });
    }
  }
});

function makeOpenAIChunk(msgId, model, delta, finishReason) {
  return JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finishReason || null }] });
}

// OpenAI-compatible endpoint (converts to Anthropic)
app.use("/v1", async (req, res) => {
  const id = ++requestCount;
  const reqPath = req.path;
  log(id, `${req.method} /v1${reqPath}`);

  if (req.method === "GET") {
    try {
      const response = await axios.get(`${config.apiBase}/v1${reqPath}`, { headers: { Authorization: `Bearer ${config.apiKey}` } });
      return res.json(response.data);
    } catch (error) {
      return res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  }

  const model = config.model;
  const messages = convertMessages(req.body?.messages);
  const tools = convertTools(req.body?.tools);
  const isStream = req.body?.stream === true;

  // Dedup
  const dedupKey = getRequestKey(req.body);
  if (dedupKey && isStream) {
    const cached = recentRequests.get(dedupKey);
    if (cached && Date.now() - cached.timestamp < DEDUP_WINDOW) {
      log(id, `DEDUP: piggybacking on live stream`);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      cached.subscribers.push(res);
      for (const chunk of cached.chunks) res.write(chunk);
      await cached.promise.catch(() => {});
      res.end();
      return;
    }
  }

  const recordedChunks = [];
  const subscribers = [];
  let dedupResolve;
  const dedupPromise = new Promise(r => { dedupResolve = r; });
  if (dedupKey && isStream) {
    recentRequests.set(dedupKey, { promise: dedupPromise, chunks: recordedChunks, subscribers, timestamp: Date.now() });
  }

  log(id, `model: ${req.body?.model} -> ${model} | stream: ${isStream} | msgs: ${messages.length} | tools: ${tools?.length || 0}`);

  const anthropicBody = { model, max_tokens: req.body?.max_tokens || 8192, messages, stream: isStream };
  if (tools && tools.length > 0) anthropicBody.tools = tools;
  if (req.body?.temperature !== undefined) anthropicBody.temperature = req.body.temperature;
  if (req.body?.top_p !== undefined) anthropicBody.top_p = req.body.top_p;

  try {
    const response = await axios.post(`${config.apiBase}/v1/messages`, anthropicBody, {
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      responseType: isStream ? "stream" : "json", timeout: 120000
    });

    log(id, `Response: ${response.status}`);

    if (!isStream) {
      const data = response.data;
      const content = data.content?.map(b => b.text || "").join("") || "";
      dedupResolve();
      return res.json({ id: data.id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const msgId = "chatcmpl-" + Date.now();
    let buffer = "", eventCount = 0, sentCount = 0, toolIndex = -1;

    const writeChunk = (chunk) => {
      res.write(chunk);
      recordedChunks.push(chunk);
      for (const sub of subscribers) { try { sub.write(chunk); } catch {} }
    };

    response.data.on("data", (raw) => {
      buffer += raw.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("event: ")) continue;
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6);
        if (dataStr === "[DONE]") { writeChunk("data: [DONE]\n\n"); sentCount++; continue; }
        let data;
        try { data = JSON.parse(dataStr); } catch { continue; }
        eventCount++;
        if (data.type === "message_start") {
          writeChunk(`data: ${makeOpenAIChunk(msgId, model, { role: "assistant", content: "" })}\n\n`); sentCount++;
        } else if (data.type === "content_block_start" && data.content_block?.type === "tool_use") {
          toolIndex++;
          writeChunk(`data: ${makeOpenAIChunk(msgId, model, { tool_calls: [{ index: toolIndex, id: data.content_block.id || `call_${toolIndex}`, type: "function", function: { name: data.content_block.name, arguments: "" } }] })}\n\n`); sentCount++;
        } else if (data.type === "content_block_delta") {
          if (data.delta?.type === "text_delta" && data.delta.text) { writeChunk(`data: ${makeOpenAIChunk(msgId, model, { content: data.delta.text })}\n\n`); sentCount++; }
          else if (data.delta?.type === "thinking_delta" && data.delta.thinking) { writeChunk(`data: ${makeOpenAIChunk(msgId, model, { content: data.delta.thinking })}\n\n`); sentCount++; }
          else if (data.delta?.type === "input_json_delta" && data.delta.partial_json) { writeChunk(`data: ${makeOpenAIChunk(msgId, model, { tool_calls: [{ index: toolIndex, function: { arguments: data.delta.partial_json } }] })}\n\n`); sentCount++; }
        } else if (data.type === "message_delta" && data.delta?.stop_reason) {
          const reason = data.delta.stop_reason === "end_turn" ? "stop" : data.delta.stop_reason === "tool_use" ? "tool_calls" : "stop";
          writeChunk(`data: ${makeOpenAIChunk(msgId, model, {}, reason)}\n\n`); sentCount++;
        } else if (data.type === "message_stop") {
          writeChunk("data: [DONE]\n\n"); sentCount++;
        }
      }
    });
    response.data.on("end", () => { log(id, `Stream ended: ${eventCount} events -> ${sentCount} chunks`); dedupResolve(); res.end(); });
    response.data.on("error", (e) => { log(id, `Stream error: ${e.message}`); dedupResolve(); res.end(); });
  } catch (error) {
    dedupResolve();
    const status = error.response?.status || 500;
    const data = error.response?.data;
    if (data && typeof data.pipe === "function") {
      let errBody = ""; data.on("data", (chunk) => errBody += chunk);
      data.on("end", () => { log(id, `Error ${status}: ${errBody.slice(0, 500)}`); res.status(status).json({ error: { message: errBody } }); });
    } else {
      const errMsg = data ? JSON.stringify(data) : error.message;
      log(id, `Error ${status}: ${errMsg.slice(0, 500)}`);
      res.status(status).json(data || { error: { message: error.message } });
    }
  }
});

server.listen(config.port, () => {
  const url = `http://localhost:${config.port}`;
  console.log(`\n  Cursor Proxy running on ${url}`);
  console.log(`  Admin UI: ${url}/admin`);
  console.log(`  Target: ${config.apiBase}`);
  console.log(`  Model: ${config.model}\n`);
  // Auto-open browser
  const cmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  require("child_process").exec(`${cmd} ${url}`);
});
