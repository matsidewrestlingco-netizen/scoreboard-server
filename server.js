/**
 * Matside Scoreboard Server v2.10
 * - Multi-mat state
 * - Timer ticking
 * - Events saving (GitHub push)
 * - NEW: Match Results logging (GitHub push)
 */

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const fetch = require("node-fetch");

require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// --------------------------------------------------------------
// GitHub API Config
// --------------------------------------------------------------
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "matsidewrestlingco-netizen/scoreboard-server";
const EVENTS_PATH = "public/events.json";
const MATCH_RESULTS_PATH = "public/match-results.json";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/contents/`;

/** Push a JSON file to GitHub */
async function pushToGitHub(path, jsonData, commitMsg) {
  try {
    // 1. Get current file SHA
    let sha = null;
    const metaRes = await fetch(GITHUB_API_URL + path, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    });

    if (metaRes.status === 200) {
      const meta = await metaRes.json();
      sha = meta.sha;
    }

    const base64Content = Buffer.from(JSON.stringify(jsonData, null, 2)).toString("base64");

    // 2. Push update
    const updateRes = await fetch(GITHUB_API_URL + path, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      },
      body: JSON.stringify({
        message: commitMsg,
        content: base64Content,
        sha
      })
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      console.error("[GitHub Push ERROR]", err);
      return false;
    }

    return true;
  } catch (e) {
    console.error("[GitHub Push Exception]", e);
    return false;
  }
}

// --------------------------------------------------------------
// Default Data Files
// --------------------------------------------------------------
let eventsData = [];
let matchResults = [];

// load from GitHub at startup
async function loadFromGitHub(path) {
  try {
    const res = await fetch(GITHUB_API_URL + path, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    });

    if (!res.ok) return null;

    const data = await res.json();
    const decoded = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
    return decoded;
  } catch (err) {
    console.error("[GitHub load error]", err);
    return null;
  }
}

// load events + results on startup:
(async () => {
  const e = await loadFromGitHub(EVENTS_PATH);
  if (e) eventsData = e;

  const r = await loadFromGitHub(MATCH_RESULTS_PATH);
  if (r) matchResults = r;
})();

// --------------------------------------------------------------
// REST API Routes
// --------------------------------------------------------------
app.get("/events.json", (req, res) => {
  res.json(eventsData);
});

app.post("/save-events", async (req, res) => {
  eventsData = req.body.events || [];

  const ok = await pushToGitHub(EVENTS_PATH, eventsData, "Update events.json");
  if (!ok) return res.json({ error: "GitHub write failed" });

  res.json({ success: true });
});

// NEW: return match history
app.get("/match-results", (req, res) => {
  res.json(matchResults);
});

// NEW: save match results
app.post("/save-match-result", async (req, res) => {
  const entry = req.body;

  matchResults.push(entry);

  const ok = await pushToGitHub(MATCH_RESULTS_PATH, matchResults, "Add match result");
  if (!ok) return res.json({ error: "GitHub write failed" });

  res.json({ success: true });
});

// --------------------------------------------------------------
// MULTI-MAT SCOREBOARD STATE
// --------------------------------------------------------------
const mats = {
  1: { period: 1, time: 60, running: false, red: 0, green: 0 },
  2: { period: 1, time: 60, running: false, red: 0, green: 0 },
  3: { period: 1, time: 60, running: false, red: 0, green: 0 },
  4: { period: 1, time: 60, running: false, red: 0, green: 0 }
};

// --------------------------------------------------------------
// SERVER + SOCKET
// --------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Broadcast full state
function emitState() {
  io.emit("stateUpdate", { mats });
}

// Update timers every 1s
setInterval(() => {
  for (let mat of [1,2,3,4]) {
    const m = mats[mat];
    if (m.running && m.time > 0) {
      m.time--;
      if (m.time === 0) {
        m.running = false;
      }
    }
  }
  emitState();
}, 1000);

// --------------------------------------------------------------
// SOCKET HANDLING
// --------------------------------------------------------------
io.on("connection", socket => {

  socket.emit("stateUpdate", { mats });

  socket.on("updateState", ({ mat, updates }) => {
    Object.assign(mats[mat], updates);
    emitState();
  });

  socket.on("addPoints", ({ mat, color, pts }) => {
    mats[mat][color] += pts;
    emitState();
  });

  socket.on("subPoint", ({ mat, color }) => {
    mats[mat][color] = Math.max(0, mats[mat][color] - 1);
    emitState();
  });

  // NEW: match-ended event
  socket.on("matchEnded", async (data) => {
    console.log("[Match Ended]", data);

    matchResults.push(data);

    await pushToGitHub(MATCH_RESULTS_PATH, matchResults, "Add match result");

    emitState();
  });

});

// --------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on", PORT);
});
