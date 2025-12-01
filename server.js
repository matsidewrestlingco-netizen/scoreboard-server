/**
 * Matside Scoreboard Server v2.20
 * -----------------------------------------------
 * + Fully supports segmentId (REG1 → OT → TB1 → TB2 → UT)
 * + Compatible with new modular control panel
 * + Keeps all existing features (multi-mat, GitHub syncing, events, results)
 * + No node-fetch required (uses global fetch)
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
// MONITORING (in-memory only)
// -----------------------------------------------------
const monitor = {
  heartbeats: {
    control: {},
    scoreboard: {}
  },
  diagnostics: {
    control: {},
    scoreboard: {}
  }
};

// -----------------------------------------------------
// GitHub Helpers
// -----------------------------------------------------
async function pushToGitHub(path, jsonData, commitMsg) {
  try {
    // 1. Check if file exists
    let sha = null;

    const meta = await fetch(GITHUB_API_URL + path, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    });

    if (meta.ok) {
      const info = await meta.json();
      sha = info.sha;
    }

    const content = Buffer.from(
      JSON.stringify(jsonData, null, 2)
    ).toString("base64");

    // 2. Push update
    const res = await fetch(GITHUB_API_URL + path, {
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

    if (!res.ok) {
      const txt = await res.text();
      console.error("[GitHub Push Failed]", txt);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[GitHub Push Exception]", err);
    return false;
  }
}

async function loadFromGitHub(path) {
  try {
    const res = await fetch(GITHUB_API_URL + path, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    });

    if (!res.ok) return null;

    const file = await res.json();
    return JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  } catch (err) {
    console.error("[GitHub Load Error]", err);
    return null;
  }
}

// -----------------------------------------------------
// Load events + results on server start
// -----------------------------------------------------
let eventsData = [];
let matchResults = [];

(async () => {
  const e = await loadFromGitHub(EVENTS_PATH);
  if (e) eventsData = e;

  const m = await loadFromGitHub(RESULTS_PATH);
  if (m) matchResults = m;

  console.log("[Startup] Loaded Events:", eventsData.length);
  console.log("[Startup] Loaded Match Results:", matchResults.length);
})();

// -----------------------------------------------------
// REST API Endpoints
// -----------------------------------------------------
app.get("/events.json", (req, res) => res.json(eventsData));

app.post("/save-events", async (req, res) => {
  eventsData = req.body.events || [];

  const ok = await pushToGitHub(EVENTS_PATH, eventsData, "Update events.json");
  res.json(ok ? { success: true } : { error: "GitHub write failed" });
});

app.get("/match-results", (req, res) => res.json(matchResults));

app.post("/save-match-result", async (req, res) => {
  const entry = req.body;
  matchResults.push(entry);

  const ok = await pushToGitHub(RESULTS_PATH, matchResults, "Add match result");
  res.json(ok ? { success: true } : { error: "GitHub write failed" });
});

// -----------------------------------------------------
// Multi-Mat Scoreboard State
// -----------------------------------------------------
/**
 * NEW: server now tracks `segmentId` instead of `period`
 */
function newMatState() {
  return {
    segmentId: "REG1",
    time: 60,
    running: false,
    red: 0,
    green: 0
  };
}

const mats = {
  1: newMatState(),
  2: newMatState(),
  3: newMatState(),
  4: newMatState()
};

// -----------------------------------------------------
// Timer Loop (every 1s)
// -----------------------------------------------------
function tickTimers() {
  for (const mat of [1, 2, 3, 4]) {
    const m = mats[mat];

    if (m.running && m.time > 0) {
      m.time -= 1;

      if (m.time <= 0) {
        m.time = 0;
        m.running = false;
      }
    }
  }

  // push updates + monitoring data
  io.emit("stateUpdate", {
    mats,
    monitor
  });
}

setInterval(tickTimers, 1000);

// -----------------------------------------------------
// SOCKET.IO
// -----------------------------------------------------
const serverHTTP = http.createServer(app);
const io = new Server(serverHTTP, { cors: { origin: "*" } });

io.on("connection", socket => {
  console.log("[Socket] Client connected");

  // Send full state immediately
  socket.emit("stateUpdate", {
    mats,
    monitor
  });

  // Update part of a mat state
  socket.on("updateState", ({ mat, updates }) => {
    if (!mats[mat]) return;

    Object.assign(mats[mat], updates);

    io.emit("stateUpdate", {
      mats,
      monitor
    });
  });

  // Add scoring
  socket.on("addPoints", ({ mat, color, pts }) => {
    if (!mats[mat]) return;
    mats[mat][color] += pts;

    io.emit("stateUpdate", {
      mats,
      monitor
    });
  });

  // Subtract scoring
  socket.on("subPoint", ({ mat, color }) => {
    if (!mats[mat]) return;
    mats[mat][color] = Math.max(0, mats[mat][color] - 1);

    io.emit("stateUpdate", {
      mats,
      monitor
    });
  });

  // End match → write to results.json
  socket.on("matchEnded", async (data) => {
    matchResults.push(data);
    await pushToGitHub(RESULTS_PATH, matchResults, "Add match result");

    io.emit("stateUpdate", {
      mats,
      monitor
    });
  });

  // Heartbeats for admin monitoring
  socket.on("heartbeat", ({ type, mat, ts }) => {
    if (!monitor.heartbeats[type]) monitor.heartbeats[type] = {};
    monitor.heartbeats[type][mat] = {
      ts: Date.now(),
      clientTs: ts
    };
  });

  // Diagnostics (FPS, memory, reconnects, etc.)
  socket.on("clientDiagnostics", ({ type, mat, ...rest }) => {
    if (!monitor.diagnostics[type]) monitor.diagnostics[type] = {};
    monitor.diagnostics[type][mat] = {
      ...rest,
      ts: Date.now()
    };
  });
});

// -----------------------------------------------------
// Start Server
// -----------------------------------------------------
const PORT = process.env.PORT || 3000;
serverHTTP.listen(PORT, () =>
  console.log("Matside Server running on port", PORT)
);
