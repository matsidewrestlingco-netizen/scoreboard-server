// ==============================
// server.js  (place at repo root)
// ==============================
const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");

// ---- Basic server setup ----
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Serve static frontend from /public
app.use(express.static(path.join(__dirname, "public")));

// ---- Scoreboard state ----
function createMatState() {
  return {
    time: 0,       // countdown seconds
    running: false,
    red: 0,
    green: 0,
    period: 1
  };
}

const state = {
  mats: {
    1: createMatState(),
    2: createMatState(),
    3: createMatState(),
    4: createMatState()
  }
};

// ---- Countdown timer tick ----
// Decrements time for running mats once per second.
setInterval(() => {
  let changed = false;

  Object.keys(state.mats).forEach((matKey) => {
    const m = state.mats[matKey];
    if (m.running && m.time > 0) {
      m.time -= 1;
      changed = true;

      // Stop at zero (no auto-advance here; panel will handle extra logic if needed)
      if (m.time <= 0) {
        m.time = 0;
        m.running = false;
      }
    }
  });

  if (changed) {
    io.emit("stateUpdate", state);
  }
}, 1000);

// ---- Socket.IO handlers ----
io.on("connection", (socket) => {
  // Send current state to new client
  socket.emit("stateUpdate", state);

  socket.on("updateState", ({ mat, updates }) => {
    const m = state.mats[mat];
    if (!m || !updates || typeof updates !== "object") return;

    const u = { ...updates };

    // Period delta support (from control panel)
    if (typeof u.periodChange === "number") {
      const delta = u.periodChange;
      delete u.periodChange;
      m.period = Math.max(1, (m.period || 1) + delta);
    }

    // Merge remaining updates directly
    Object.assign(m, u);
    io.emit("stateUpdate", state);
  });

  socket.on("addPoints", ({ mat, color, pts }) => {
    const m = state.mats[mat];
    if (!m || !color || typeof pts !== "number") return;

    if (color === "red") {
      m.red = Math.max(0, m.red + pts);
    } else if (color === "green") {
      m.green = Math.max(0, m.green + pts);
    }
    io.emit("stateUpdate", state);
  });

  socket.on("subPoint", ({ mat, color }) => {
    const m = state.mats[mat];
    if (!m || !color) return;

    if (color === "red") {
      m.red = Math.max(0, m.red - 1);
    } else if (color === "green") {
      m.green = Math.max(0, m.green - 1);
    }
    io.emit("stateUpdate", state);
  });
});

// ---- GitHub-backed events.json support ----
// Uses environment variables:
//   GITHUB_TOKEN
//   GITHUB_REPO        e.g. "matsidewrestlingco-netizen/scoreboard-server"
//   GITHUB_FILE_PATH   e.g. "public/events.json"
//   GITHUB_BRANCH      e.g. "main"
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || "matsidewrestlingco-netizen/scoreboard-server";
const GITHUB_FILE_PATH = process.env.GITHUB_FILE_PATH || "public/events.json";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

async function githubFetchJSON() {
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN not set");
  }

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(
    GITHUB_FILE_PATH
  )}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "matside-scoreboard"
    }
  });

  if (!res.ok) {
    throw new Error(`GitHub read failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const decoded = Buffer.from(json.content, "base64").toString("utf8");
  return { json: JSON.parse(decoded), sha: json.sha };
}

async function githubWriteJSON(contentObj, sha) {
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN not set");
  }

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(
    GITHUB_FILE_PATH
  )}`;

  const body = {
    message: "Update events.json from Matside admin UI",
    content: Buffer.from(JSON.stringify(contentObj, null, 2), "utf8").toString("base64"),
    sha,
    branch: GITHUB_BRANCH
  };

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "matside-scoreboard"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`GitHub write failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// GET /events.json -> proxy from GitHub
app.get("/events.json", async (req, res) => {
  try {
    const { json } = await githubFetchJSON();
    res.json(json);
  } catch (err) {
    console.error("[Events] GitHub read error:", err.message);
    res.status(500).json({ error: "GitHub read failed" });
  }
});

// POST /save-events -> body: { events: [...] }
app.post("/save-events", async (req, res) => {
  try {
    const events = req.body?.events;
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: "Invalid events payload" });
    }

    const { json: current, sha } = await githubFetchJSON();
    const updated = { ...current, events };

    await githubWriteJSON(updated, sha);
    res.json({ ok: true });
  } catch (err) {
    console.error("[Events] GitHub write error:", err.message);
    res.status(500).json({ error: "GitHub write failed" });
  }
});

// Root route
app.get("/", (req, res) => {
  res.send("Matside Scoreboard server is running.");
});

// ---- Start server ----
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});



/* ==========================================
   public/control.html  (place in /public)
   ========================================== */
