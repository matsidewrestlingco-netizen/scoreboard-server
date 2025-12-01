/**
 * Matside Scoreboard Server v3.0
 * -------------------------------------------
 * - Multi-mat scoreboard sync (4 mats)
 * - GitHub-backed events.json + match-results.json
 * - Socket.io real-time updates
 * - Device monitoring (registerDevice, heartbeat, clientDiagnostics)
 * - /device-status API for hub.html
 *
 * NOTE: Node 18+ has global fetch, so no node-fetch required.
 */

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

// -----------------------------------------------------
// GitHub Repo Settings
// -----------------------------------------------------
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "matsidewrestlingco-netizen/scoreboard-server";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/contents/`;

const EVENTS_PATH = "public/events.json";
const RESULTS_PATH = "public/match-results.json";

// -----------------------------------------------------
// Express Setup
// -----------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: "3mb" }));

// -----------------------------------------------------
// In-memory data
// -----------------------------------------------------
let eventsData = [];
let matchResults = [];

// Device + monitor data (in-memory only)
const devices = {}; // devices[socket.id] = { type, mat, lastHeartbeat, online }

const monitor = {
  heartbeats: {
    control: {},   // mat -> { ts, clientTs }
    scoreboard: {} // mat -> { ts, clientTs }
  },
  diagnostics: {
    control: {},   // mat -> { fps, uptime, reconnects, usedHeap, ts }
    scoreboard: {} // mat -> { fps, uptime, reconnects, usedHeap, ts }
  }
};

// Multi-mat scoreboard state
const mats = {
  1: { period: 1, time: 60, running: false, red: 0, green: 0 },
  2: { period: 1, time: 60, running: false, red: 0, green: 0 },
  3: { period: 1, time: 60, running: false, red: 0, green: 0 },
  4: { period: 1, time: 60, running: false, red: 0, green: 0 }
};

// -----------------------------------------------------
// GitHub Helpers
// -----------------------------------------------------
async function pushToGitHub(path, jsonData, commitMsg) {
  if (!GITHUB_TOKEN) {
    console.error("[GitHub] No GITHUB_TOKEN set");
    return { ok: false, error: "No GITHUB_TOKEN" };
  }

  try {
    // 1) Get existing file metadata (for sha)
    let sha = null;
    const metaRes = await fetch(GITHUB_API_URL + path, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    });

    if (metaRes.ok) {
      const info = await metaRes.json();
      sha = info.sha;
    } else {
      const metaText = await metaRes.text();
      console.warn("[GitHub META] status:", metaRes.status, "body:", metaText);
      // It's OK if file doesn't exist yet (404) – we'll create it.
    }

    const content = Buffer.from(JSON.stringify(jsonData, null, 2)).toString("base64");

    // 2) PUT new content
    const pushRes = await fetch(GITHUB_API_URL + path, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      },
      body: JSON.stringify({
        message: commitMsg,
        content,
        sha
      })
    });

    const pushBodyText = await pushRes.text();
    let pushBody = null;
    try { pushBody = JSON.parse(pushBodyText); } catch (_) {}

    if (!pushRes.ok) {
      console.error("[GitHub PUSH FAILED] status:", pushRes.status, "body:", pushBodyText);
      return {
        ok: false,
        status: pushRes.status,
        body: pushBodyText
      };
    }

    console.log("[GitHub PUSH OK] status:", pushRes.status, "commit:", pushBody && pushBody.commit && pushBody.commit.sha);
    return { ok: true };
  } catch (err) {
    console.error("[GitHub Push Exception]", err);
    return { ok: false, error: err.message };
  }
}

async function loadFromGitHub(path) {
  if (!GITHUB_TOKEN) {
    console.error("[GitHub] No GITHUB_TOKEN set, cannot load", path);
    return null;
  }

  try {
    const res = await fetch(GITHUB_API_URL + path, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    });

    if (!res.ok) {
      console.warn("[GitHub Load] Non-OK", path, res.status);
      return null;
    }

    const file = await res.json();
    return JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  } catch (err) {
    console.error("[GitHub Load Error]", err);
    return null;
  }
}

// -----------------------------------------------------
// Load Events + Match Results on Boot
// -----------------------------------------------------
(async () => {
  try {
    const e = await loadFromGitHub(EVENTS_PATH);
    if (Array.isArray(e)) eventsData = e;
  } catch (_) {}

  try {
    const m = await loadFromGitHub(RESULTS_PATH);
    if (Array.isArray(m)) matchResults = m;
  } catch (_) {}

  console.log("[Startup] Loaded events:", eventsData.length);
  console.log("[Startup] Loaded match results:", matchResults.length);
})();

// -----------------------------------------------------
// REST API Routes
// -----------------------------------------------------
app.post("/save-events", async (req, res) => {
  eventsData = req.body.events || [];

  const result = await pushToGitHub(EVENTS_PATH, eventsData, "Update events.json");

  if (!result.ok) {
    console.error("[/save-events] GitHub write failed:", result);
    return res.status(500).json({
      error: "GitHub write failed",
      detail: result
    });
  }

  return res.json({ success: true });
});
app.get("/match-results", (req, res) => {
  res.json(matchResults);
});

app.post("/save-match-result", async (req, res) => {
  const entry = req.body;
  matchResults.push(entry);

  const ok = await pushToGitHub(RESULTS_PATH, matchResults, "Add match result");
  if (!ok) return res.status(500).json({ error: "GitHub write failed" });

  return res.json({ success: true });
});

// Device status API for hub.html (Option B: monitor via API, not in stateUpdate)
app.get("/device-status", (req, res) => {
  const list = Object.entries(devices).map(([id, d]) => ({
    id,
    type: d.type,
    mat: d.mat,
    online: !!d.online,
    lastSeen: d.lastHeartbeat
  }));

  res.json({
    devices: list,
    monitor
  });
});

// -----------------------------------------------------
// HTTP Server + Socket.io
// -----------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// -----------------------------------------------------
// Timer Loop — Updates Every 1 Second
// -----------------------------------------------------
function tickTimers() {
  for (const mat of [1, 2, 3, 4]) {
    const m = mats[mat];

    if (m.running && m.time > 0) {
      m.time -= 1;

      if (m.time <= 0) {
        m.time = 0;
        m.running = false;
        // Any period/OT logic can stay on the client for now
      }
    }
  }

  // IMPORTANT: per your option B, we only send mats here (no monitor)
  io.emit("stateUpdate", { mats });
}

setInterval(tickTimers, 1000);

// -----------------------------------------------------
// Broadcast device status to all listeners
// -----------------------------------------------------
function broadcastDeviceStatus() {
  const list = Object.entries(devices).map(([id, d]) => ({
    id,
    type: d.type,
    mat: d.mat,
    online: !!d.online,
    lastSeen: d.lastHeartbeat
  }));

  io.emit("deviceStatusUpdate", list);
}

// Clean up stale devices (no heartbeat > 15s)
setInterval(() => {
  const now = Date.now();
  let changed = false;

  for (const [id, dev] of Object.entries(devices)) {
    if (dev.online && now - dev.lastHeartbeat > 15000) {
      dev.online = false;
      changed = true;
    }
  }

  if (changed) broadcastDeviceStatus();
}, 5000);

// -----------------------------------------------------
// Socket.io Connections
// -----------------------------------------------------
io.on("connection", (socket) => {
  console.log("[Socket] Connected:", socket.id);

  // Immediately send current mats state
  socket.emit("stateUpdate", { mats });

  // ---------- Device Registration ----------
  socket.on("registerDevice", ({ type, mat }) => {
    devices[socket.id] = {
      type: type || "unknown",
      mat: mat || null,
      lastHeartbeat: Date.now(),
      online: true
    };
    console.log(`[Device] Registered ${socket.id} as ${type || "unknown"} (mat ${mat || "-"})`);
    broadcastDeviceStatus();
  });

  // ---------- Heartbeat ----------
  socket.on("heartbeat", (payload = {}) => {
    const now = Date.now();
    const dev = devices[socket.id];
    if (dev) {
      dev.lastHeartbeat = now;
      dev.online = true;
    }

    const { type, mat, ts } = payload;
    if (type && mat != null) {
      if (!monitor.heartbeats[type]) monitor.heartbeats[type] = {};
      monitor.heartbeats[type][mat] = {
        ts: now,
        clientTs: ts || null
      };
    }

    broadcastDeviceStatus();
  });

  // ---------- Client Diagnostics ----------
  socket.on("clientDiagnostics", (payload = {}) => {
    const { type, mat, ...rest } = payload;
    if (!type || mat == null) return;

    if (!monitor.diagnostics[type]) monitor.diagnostics[type] = {};
    monitor.diagnostics[type][mat] = {
      ...rest,
      ts: Date.now()
    };
  });

  // ---------- Scoreboard / Control Operations ----------
  socket.on("updateState", ({ mat, updates }) => {
    if (!mats[mat]) return;
    Object.assign(mats[mat], updates || {});
    io.emit("stateUpdate", { mats });
  });

  socket.on("addPoints", ({ mat, color, pts }) => {
    if (!mats[mat] || (color !== "red" && color !== "green")) return;
    mats[mat][color] += Number(pts) || 0;
    io.emit("stateUpdate", { mats });
  });

  socket.on("subPoint", ({ mat, color }) => {
    if (!mats[mat] || (color !== "red" && color !== "green")) return;
    mats[mat][color] = Math.max(0, mats[mat][color] - 1);
    io.emit("stateUpdate", { mats });
  });

  socket.on("resetMat", ({ mat }) => {
    if (!mats[mat]) return;
    mats[mat] = { period: 1, time: 60, running: false, red: 0, green: 0 };
    io.emit("stateUpdate", { mats });
  });

  // ---------- Match Ended ----------
  socket.on("matchEnded", async (data) => {
    console.log("[Match Ended]", data);
    matchResults.push(data);
    await pushToGitHub(RESULTS_PATH, matchResults, "Add match result");
    io.emit("stateUpdate", { mats });
  });

  // ---------- Admin Hooks (optional, currently no-op on server) ----------
  socket.on("adminResetMat", ({ mat }) => {
    if (!mats[mat]) return;
    mats[mat] = { period: 1, time: 60, running: false, red: 0, green: 0 };
    io.emit("stateUpdate", { mats });
  });

  socket.on("adminClearTimeline", ({ mat }) => {
    // If you later store timeline server-side, clear it here.
    // Right now, timeline is client-side only.
  });

  socket.on("adminNotifyReload", ({ type, mat }) => {
    // Optionally broadcast a message that certain clients listen for
    // e.g. socket.emit("reloadRequested", { type, mat });
  });

  socket.on("disconnect", () => {
    console.log("[Socket] Disconnected:", socket.id);
    if (devices[socket.id]) {
      devices[socket.id].online = false;
      broadcastDeviceStatus();
    }
  });
});

// -----------------------------------------------------
// Start Server
// -----------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Matside Server running on port", PORT);
});
