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

export function appendEvent(data, { replay = false } = {}) {
  const stream = document.getElementById("event-stream");
  if (!stream) return;

  const type = data.type || "unknown";
  const payload = data.payload || {};
  const direction = data.direction || "inbound";

  // Early filter: skip bridge init noise regardless of event type
  const serialized = JSON.stringify(data);
  if (/Remote Control connecting/i.test(serialized)) return;

  // During history replay, only render messages & tools — skip interactive/stateful events
  if (replay) {
    let histEl;
    switch (type) {
      case "user":
        if (direction === "outbound") histEl = renderUserMessage(payload, direction);
        break;
      case "assistant":
        {
          const text = extractText(payload);
          if (text && text.trim()) histEl = renderAssistantMessage(payload);
        }
        break;
      case "tool_use":
        histEl = renderToolUse(payload);
        break;
      case "tool_result":
        histEl = renderToolResult(payload);
        break;
      case "error":
        histEl = renderSystemMessage(`Error: ${payload.message || payload.content || "Unknown error"}`);
        break;
      // Skip: partial_assistant, result, control_request, control_response,
      //       permission_response, status, interrupt, system, user inbound echoes
      default:
        return;
    }
    if (histEl) {
      stream.appendChild(histEl);
      stream.scrollTop = stream.scrollHeight;
    }
    return;
  }

  let el;
  let needLoading = false;

  switch (type) {
    case "user":
      // Skip inbound user messages — they're echoes of what we already sent
      if (direction === "inbound") return;
      el = renderUserMessage(payload, direction);
      needLoading = true;
      break;
    case "partial_assistant":
      // Skip partial assistant — wait for the final "assistant" event
      // to avoid blank/duplicate messages during streaming
      return;
    case "assistant":
      removeLoading();
      // Skip empty assistant messages
      {
        const text = extractText(payload);
        if (!text || !text.trim()) return;
        el = renderAssistantMessage(payload);
      }
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
    case "permission_response":
      // Skip — these are just acknowledgments, no need to show in stream
      return;
    case "status":
      // Skip connecting/waiting status noise from bridge
      {
        const msg = payload.message || payload.content || "";
        const fullText = typeof payload === "string" ? payload : JSON.stringify(payload);
        if (/connecting|waiting|initializing|Remote Control/i.test(msg + " " + fullText)) return;
        if (!msg.trim()) return;
        el = renderSystemMessage(msg);
      }
      break;
    case "error":
      removeLoading();
      el = renderSystemMessage(`Error: ${payload.message || payload.content || "Unknown error"}`);
      break;
    case "interrupt":
      removeLoading();
      el = renderSystemMessage("Session interrupted");
      break;
    case "system":
      // Skip raw system/init messages — they're noise
      return;
    default: {
      // Skip noise from bridge init
      const raw = JSON.stringify(payload);
      if (/Remote Control connecting/i.test(raw)) return;
      el = renderSystemMessage(`${type}: ${truncate(raw, 200)}`);
    }
  }

  if (el) {
    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
  }

  // Show loading after the message element is in the DOM so it renders below
  if (needLoading) showLoading();
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
// Loading Indicator — TUI star spinner style
// ============================================================

const LOADING_ID = "loading-indicator";

// TUI star spinner frames (same as Claude Code CLI)
const SPINNER_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽"];
const SPINNER_CYCLE = [...SPINNER_FRAMES, ...SPINNER_FRAMES.slice().reverse()];

// 204 verbs from TUI src/constants/spinnerVerbs.ts
const SPINNER_VERBS = [
  "Accomplishing","Actioning","Actualizing","Architecting","Baking","Beaming",
  "Beboppin'","Befuddling","Billowing","Blanching","Bloviating","Boogieing",
  "Boondoggling","Booping","Bootstrapping","Brewing","Bunning","Burrowing",
  "Calculating","Canoodling","Caramelizing","Cascading","Catapulting","Cerebrating",
  "Channeling","Channelling","Choreographing","Churning","Clauding","Coalescing",
  "Cogitating","Combobulating","Composing","Computing","Concocting","Considering",
  "Contemplating","Cooking","Crafting","Creating","Crunching","Crystallizing",
  "Cultivating","Deciphering","Deliberating","Determining","Dilly-dallying",
  "Discombobulating","Doing","Doodling","Drizzling","Ebbing","Effecting",
  "Elucidating","Embellishing","Enchanting","Envisioning","Evaporating",
  "Fermenting","Fiddle-faddling","Finagling","Flambéing","Flibbertigibbeting",
  "Flowing","Flummoxing","Fluttering","Forging","Forming","Frolicking","Frosting",
  "Gallivanting","Galloping","Garnishing","Generating","Gesticulating",
  "Germinating","Gitifying","Grooving","Gusting","Harmonizing","Hashing",
  "Hatching","Herding","Honking","Hullaballooing","Hyperspacing","Ideating",
  "Imagining","Improvising","Incubating","Inferring","Infusing","Ionizing",
  "Jitterbugging","Julienning","Kneading","Leavening","Levitating","Lollygagging",
  "Manifesting","Marinating","Meandering","Metamorphosing","Misting","Moonwalking",
  "Moseying","Mulling","Mustering","Musing","Nebulizing","Nesting","Newspapering",
  "Noodling","Nucleating","Orbiting","Orchestrating","Osmosing","Perambulating",
  "Percolating","Perusing","Philosophising","Photosynthesizing","Pollinating",
  "Pondering","Pontificating","Pouncing","Precipitating","Prestidigitating",
  "Processing","Proofing","Propagating","Puttering","Puzzling","Quantumizing",
  "Razzle-dazzling","Razzmatazzing","Recombobulating","Reticulating","Roosting",
  "Ruminating","Sautéing","Scampering","Schlepping","Scurrying","Seasoning",
  "Shenaniganing","Shimmying","Simmering","Skedaddling","Sketching","Slithering",
  "Smooshing","Sock-hopping","Spelunking","Spinning","Sprouting","Stewing",
  "Sublimating","Swirling","Swooping","Symbioting","Synthesizing","Tempering",
  "Thinking","Thundering","Tinkering","Tomfoolering","Topsy-turvying",
  "Transfiguring","Transmuting","Twisting","Undulating","Unfurling","Unravelling",
  "Vibing","Waddling","Wandering","Warping","Whatchamacalliting","Whirlpooling",
  "Whirring","Whisking","Wibbling","Working","Wrangling","Zesting","Zigzagging",
];

// Animation state
let spinnerInterval = null;
let timerInterval = null;
let stalledCheckInterval = null;
let spinnerFrame = 0;
let loadingStartTime = 0;
let lastActivityTime = 0;
let isStalled = false;
let loadingActive = false;

export function isLoading() {
  return loadingActive;
}

function syncActionBtn(state) {
  if (typeof window.__updateActionBtn === "function") window.__updateActionBtn(state);
}

export function showLoading() {
  removeLoading();
  const stream = document.getElementById("event-stream");
  if (!stream) return;

  loadingActive = true;
  syncActionBtn(true);

  const verb = SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)];
  loadingStartTime = Date.now();
  lastActivityTime = Date.now();
  isStalled = false;

  const el = document.createElement("div");
  el.id = LOADING_ID;
  el.className = "msg-row loading-row";
  el.innerHTML = `<span class="tui-spinner">${SPINNER_CYCLE[0]}</span><span class="tui-verb glimmer-text">${esc(verb)}…</span><span class="tui-timer">0s</span>`;
  stream.appendChild(el);
  stream.scrollTop = stream.scrollHeight;

  const spinnerEl = el.querySelector(".tui-spinner");
  const timerEl = el.querySelector(".tui-timer");
  const loadingEl = el;

  // Spinner animation — 120ms interval, same as TUI
  spinnerFrame = 0;
  spinnerInterval = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_CYCLE.length;
    if (spinnerEl) spinnerEl.textContent = SPINNER_CYCLE[spinnerFrame];
  }, 120);

  // Timer — update every second
  timerInterval = setInterval(() => {
    if (timerEl) {
      const elapsed = Math.floor((Date.now() - loadingStartTime) / 1000);
      timerEl.textContent = `${elapsed}s`;
    }
  }, 1000);

  // Stalled detection — check every 120ms (aligned with spinner)
  stalledCheckInterval = setInterval(() => {
    if (!isStalled && Date.now() - lastActivityTime > 3000) {
      isStalled = true;
      if (loadingEl) loadingEl.classList.add("stalled");
    }
  }, 120);
}

export function removeLoading() {
  if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null; }
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (stalledCheckInterval) { clearInterval(stalledCheckInterval); stalledCheckInterval = null; }
  isStalled = false;
  loadingActive = false;
  syncActionBtn(false);
  const el = document.getElementById(LOADING_ID);
  if (el) el.remove();
}

/** Reset stalled timer — call when SSE events arrive */
export function refreshLoadingActivity() {
  lastActivityTime = Date.now();
  if (isStalled) {
    isStalled = false;
    const loadingEl = document.getElementById(LOADING_ID);
    if (loadingEl) loadingEl.classList.remove("stalled");
  }
}
