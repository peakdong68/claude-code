/**
 * Remote Control — Event Rendering
 *
 * Renders session events into DOM elements for the event stream.
 */

import { esc } from "./utils.js";

// ============================================================
// Helpers
// ============================================================

function truncate(str, max) {
  if (!str) return "";
  const s = String(str);
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/**
 * Extract plain text from an event payload.
 * Server-side normalization guarantees payload.content is a string.
 * Falls back to raw/message parsing for backward compat.
 */
export function extractText(payload) {
  if (!payload) return "";

  // Normalized format (server standardized)
  if (typeof payload.content === "string" && payload.content) return payload.content;

  // Fallback: raw message.content (child process format)
  const msg = payload.message;
  if (msg && typeof msg === "object") {
    const mc = msg.content;
    if (typeof mc === "string") return mc;
    if (Array.isArray(mc)) {
      return mc
        .filter((b) => b && typeof b === "object" && b.type === "text")
        .map((b) => b.text || "")
        .join("");
    }
  }

  // Final fallback
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

function formatAssistantContent(content) {
  let html = esc(content);
  // Code blocks: ```...```
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre style="background:var(--bg-tool-card);padding:10px;border-radius:6px;overflow-x:auto;margin:6px 0;font-family:var(--font-mono);font-size:0.82rem;">${code.trim()}</pre>`;
  });
  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-tool-card);padding:2px 5px;border-radius:3px;font-family:var(--font-mono);font-size:0.85em;">$1</code>');
  // Bold: **...**
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return html;
}

// ============================================================
// Event Router
// ============================================================

export function appendEvent(data) {
  const stream = document.getElementById("event-stream");
  if (!stream) return;

  const type = data.type || "unknown";
  const payload = data.payload || {};
  const direction = data.direction || "inbound";

  let el;

  switch (type) {
    case "user":
      el = renderUserMessage(payload, direction);
      // Only show loading when we send (outbound), not for echoes
      if (direction === "outbound") {
        showLoading();
      }
      break;
    case "assistant":
    case "partial_assistant":
      removeLoading();
      el = renderAssistantMessage(payload);
      break;
    case "result":
    case "result_success":
      removeLoading();
      // Skip result — it just repeats the assistant message content
      return;
    case "tool_use":
      el = renderToolUse(payload);
      break;
    case "tool_result":
      el = renderToolResult(payload);
      break;
    case "control_request":
      if (payload.request && payload.request.subtype === "can_use_tool") {
        el = renderPermissionRequest({
          request_id: payload.request_id || data.id,
          tool_name: payload.request.tool_name || "unknown",
          tool_input: payload.request.tool_input || {},
        });
      } else {
        el = renderSystemMessage(`Control: ${payload.request?.subtype || "unknown"}`);
      }
      break;
    case "control_response":
      el = renderSystemMessage(`Control response: ${payload.response?.subtype || "done"}`);
      break;
    case "permission_response":
      el = renderSystemMessage("Permission response sent");
      break;
    case "status":
      el = renderSystemMessage(payload.message || payload.content || "Status update");
      break;
    case "error":
      el = renderSystemMessage(`Error: ${payload.message || payload.content || "Unknown error"}`);
      break;
    case "interrupt":
      el = renderSystemMessage("Session interrupted");
      break;
    case "system":
      // Skip raw system/init messages — they're noise
      return;
    default:
      el = renderSystemMessage(`${type}: ${truncate(JSON.stringify(payload), 200)}`);
  }

  if (el) {
    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
  }
}

// ============================================================
// Renderers
// ============================================================

function renderUserMessage(payload, direction) {
  const content = extractText(payload);
  const row = document.createElement("div");
  row.className = "msg-row user";
  row.innerHTML = `<div class="msg-bubble">${esc(content)}</div>`;
  return row;
}

function renderAssistantMessage(payload) {
  const content = extractText(payload);
  const row = document.createElement("div");
  row.className = "msg-row assistant";
  row.innerHTML = `<div class="msg-bubble">${formatAssistantContent(content)}</div>`;
  return row;
}

function renderResult(payload) {
  const text = payload.result || payload.subtype || "Session completed";
  const row = document.createElement("div");
  row.className = "msg-row system result";
  row.innerHTML = `<div class="msg-bubble">✓ ${esc(text)}</div>`;
  return row;
}

function renderToolUse(payload) {
  const name = payload.tool_name || payload.name || "tool";
  const input = payload.tool_input || payload.input || {};
  const inputStr = typeof input === "string" ? input : JSON.stringify(input, null, 2);

  const card = document.createElement("div");
  card.className = "msg-row tool";
  card.innerHTML = `
    <div class="tool-card">
      <div class="tool-card-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">
        <span class="tool-icon">&#9654;</span> Tool: <strong>${esc(name)}</strong>
      </div>
      <div class="tool-card-body collapsed">${esc(truncate(inputStr, 2000))}</div>
    </div>`;
  return card;
}

function renderToolResult(payload) {
  const content = payload.content || payload.output || "";
  const contentStr = typeof content === "string" ? content : JSON.stringify(content, null, 2);

  const card = document.createElement("div");
  card.className = "msg-row tool";
  card.innerHTML = `
    <div class="tool-card">
      <div class="tool-card-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">
        <span class="tool-icon">&#9654;</span> Tool Result
      </div>
      <div class="tool-card-body collapsed">${esc(truncate(contentStr, 2000))}</div>
    </div>`;
  return card;
}

export function renderPermissionRequest(payload) {
  const requestId = payload.request_id || payload.id || "";
  const toolName = payload.tool_name || "unknown";
  const toolInput = payload.tool_input || payload.input || {};
  const inputStr = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput, null, 2);

  const area = document.getElementById("permission-area");
  area.classList.remove("hidden");

  const el = document.createElement("div");
  el.className = "permission-prompt";
  el.dataset.requestId = requestId;
  el.innerHTML = `
    <div class="perm-title">Permission Request</div>
    <div class="perm-tool"><strong>${esc(toolName)}</strong>\n${esc(truncate(inputStr, 500))}</div>
    <div class="perm-actions">
      <button class="btn-approve" onclick="window._approvePerm('${esc(requestId)}', this)">Approve</button>
      <button class="btn-reject" onclick="window._rejectPerm('${esc(requestId)}', this)">Reject</button>
    </div>`;
  area.appendChild(el);

  return renderSystemMessage(`Permission requested: ${toolName}`);
}

function renderSystemMessage(text) {
  const row = document.createElement("div");
  row.className = "msg-row system";
  row.innerHTML = `<div class="msg-bubble">${esc(text)}</div>`;
  return row;
}

// ============================================================
// Loading Indicator
// ============================================================

const LOADING_ID = "loading-indicator";

export function showLoading() {
  removeLoading();
  const stream = document.getElementById("event-stream");
  if (!stream) return;
  const el = document.createElement("div");
  el.id = LOADING_ID;
  el.className = "msg-row assistant";
  el.innerHTML = `<div class="msg-bubble loading-bubble"><span class="loading-dots"><span></span><span></span><span></span></span></div>`;
  stream.appendChild(el);
  stream.scrollTop = stream.scrollHeight;
}

export function removeLoading() {
  const el = document.getElementById(LOADING_ID);
  if (el) el.remove();
}
