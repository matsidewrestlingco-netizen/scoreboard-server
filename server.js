/**
 * Matside Scoreboard Server v2.11 (Improved Edition)
 * --------------------------------------------------
 * - No node-fetch required (uses built-in fetch)
 * - Improved GitHub push handling
 * - Improved GitHub load handling
 * - Event + Match Results JSON stored in GitHub repo
 * - Multi-mat scoreboard sync
 * - Socket.io real-time updates
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
// Helper: Push a JSON file to GitHub
// -----------------------------------------------------
async function pushToGitHub(path, jsonData, commitMsg) {
  try {
    // Step 1 — check if file exists
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

    const content = Buffer.from(JSON.stringify(jsonData, null, 2))
      .toString("base64");

    // Step 2 — push update
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
      console.error("[GitHub Push Failed]\n", txt);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[GitHub Push Exception]", err);
    return false;
  }
}

// -----------------------------------------------------
// Helper: Load a File From GitHub
// -----------------------------------------------------
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
// Load Data (Events + Match Results) on Boot
// -----------------------------------------------------
let eventsData = [];
let matchResults = [];

(async () => {
  const e = await loadFromGitHub(EVENTS_PATH);
  if (e) eventsData = e;

  const m = await loadFromGitHub(RESULTS_PATH);
  if (m) matchResults = m;

  console.log("[Startup] Loaded events:", eventsData.length);
  console.log("[Startup] Loaded match results:", matchResults.length);
})();

// -----------------------------------------------------
// REST API Routes
// -----------------------------------------------------
app.get("/events.json", (req, res) => {
  res.json(eventsData);
});

app.post("/save-events", async (req, res) => {
  eventsData = req.body.events || [];

  const ok = await pushToGitHub(EVENTS_PATH, eventsData, "Update events.json");
  return res.json(ok ? { success: true } : { error: "GitHub write failed" });
});

app.get("/match-results", (req, res) => {
  res.json(matchResults);
});

app.post("/save-match-result", async (req, res) => {
  const entry = req.body;
  matchResults.push(entry);

  const ok = await pushToGitHub(
    RESULTS_PATH,
    matchResults,
    "Add match result"
  );

  return res.json(ok ? { success: true } : { error: "GitHub write failed" });
});

// -----------------------------------------------------
// Multi-Mat Scoreboard State
// -----------------------------------------------------
const mats = {
  1: { period: 1, time: 60, running: false, red: 0, green: 0 },
  2: { period: 1, time: 60, running: false, red: 0, green: 0 },
  3: { period: 1, time: 60, running: false, red: 0, green: 0 },
  4: { period: 1, time: 60, running: false, red: 0, green: 0 }
};

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
      }
    }
  }
  io.emit("stateUpdate", { mats });
}

setInterval(tickTimers, 1000);

// -----------------------------------------------------
// Socket.io Setup
// -----------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

io.on("connection", socket => {
  socket.emit("stateUpdate", { mats });

  socket.on("updateState", ({ mat, updates }) => {
    Object.assign(mats[mat], updates);
    io.emit("stateUpdate", { mats });
  });

  socket.on("addPoints", ({ mat, color, pts }) => {
    mats[mat][color] += pts;
    io.emit("stateUpdate", { mats });
  });

  socket.on("subPoint", ({ mat, color }) => {
    mats[mat][color] = Math.max(0, mats[mat][color] - 1);
    io.emit("stateUpdate", { mats });
  });

  socket.on("matchEnded", async (data) => {
    console.log("[Match Ended]", data);

    matchResults.push(data);
    await pushToGitHub(RESULTS_PATH, matchResults, "Add match result");

    io.emit("stateUpdate", { mats });
  });
});

// -----------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Matside Server running on port", PORT);
});
