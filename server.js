// ============================================================================
//  Matside Scoreboard Server (GitHub Storage Edition)
// ============================================================================

const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const cors = require("cors");
const fetch = require("node-fetch"); // Needed for GitHub API
const path = require("path");

const app = express();
const server = http.createServer(app);

// Environment Variables (Render)
const GH_TOKEN = process.env.GH_TOKEN;
const GH_REPO = process.env.GH_REPO; // e.g. "matsidewrestlingco-netizen/scoreboard-server"
const GH_FILEPATH = process.env.GH_FILEPATH; // "public/events.json"

// GitHub API endpoints
const GH_API_BASE = "https://api.github.com";

// ============================================================================
//  CORS (required for GitHub Pages + matside.org)
// ============================================================================
app.use(cors({
  origin: [
    "https://matsidewrestlingco-netizen.github.io",
    "https://www.matside.org",
    "http://localhost:3000",
    "http://localhost:5500"
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
app.options("*", cors());

app.use(express.json());

// ============================================================================
//  SERVE PUBLIC FOLDER
// ============================================================================
app.use(express.static(path.join(__dirname, "public")));

// ============================================================================
//  GET /events.json — Read events.json from GitHub
// ============================================================================
app.get("/events.json", async (req, res) => {
  try {
    const url = `${GH_API_BASE}/repos/${GH_REPO}/contents/${GH_FILEPATH}`;

    const ghRes = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${GH_TOKEN}`,
        "Accept": "application/vnd.github+json"
      }
    });

    if (!ghRes.ok) {
      console.log("[GET events.json] GitHub error:", await ghRes.text());
      return res.status(500).json({ error: "GitHub read failed" });
    }

    const fileData = await ghRes.json();
    const content = Buffer.from(fileData.content, "base64").toString("utf8");

    res.setHeader("Content-Type", "application/json");
    res.send(content);

  } catch (err) {
    console.error("[GET events.json] Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================================================
//  POST /save-events — Save events.json to GitHub
// ============================================================================
app.post("/save-events", async (req, res) => {
  try {
    const newContent = JSON.stringify(req.body, null, 2);

    // STEP 1 — Get SHA of existing file
    const getUrl = `${GH_API_BASE}/repos/${GH_REPO}/contents/${GH_FILEPATH}`;

    const getRes = await fetch(getUrl, {
      headers: {
        "Authorization": `Bearer ${GH_TOKEN}`,
        "Accept": "application/vnd.github+json"
      }
    });

    if (!getRes.ok) {
      console.log("[save-events] SHA lookup failed:", await getRes.text());
      return res.status(500).json({ ok: false, error: "GitHub SHA fetch failed" });
    }

    const data = await getRes.json();
    const sha = data.sha;

    // STEP 2 — Update file
    const updateRes = await fetch(getUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${GH_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Updated events.json via Matside Admin",
        content: Buffer.from(newContent).toString("base64"),
        sha: sha
      })
    });

    if (!updateRes.ok) {
      console.log("[save-events] GitHub write failed:", await updateRes.text());
      return res.status(500).json({ ok: false, error: "GitHub write failed" });
    }

    console.log("[save-events] events.json updated successfully!");
    res.json({ ok: true });

  } catch (err) {
    console.error("[save-events] Error:", err);
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

// ============================================================================
//  SCOREBOARD STATE (unchanged)
// ============================================================================
let state = {
  mats: {
    1: { time: 0, running: false, red: 0, green: 0, period: 1, winner: null },
    2: { time: 0, running: false, red: 0, green: 0, period: 1, winner: null },
    3: { time: 0, running: false, red: 0, green: 0, period: 1, winner: null },
    4: { time: 0, running: false, red: 0, green: 0, period: 1, winner: null }
  }
};

// ============================================================================
//  SOCKET.IO — Real-time score updates
// ============================================================================
const io = socketio(server, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.emit("stateUpdate", state);

  socket.on("updateState", ({ mat, updates }) => {
    Object.assign(state.mats[mat], updates);
    io.emit("stateUpdate", state);
  });

  socket.on("addPoints", ({ mat, color, pts }) => {
    state.mats[mat][color] += pts;
    io.emit("stateUpdate", state);
  });

  socket.on("subPoint", ({ mat, color }) => {
    state.mats[mat][color] = Math.max(0, state.mats[mat][color] - 1);
    io.emit("stateUpdate", state);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// ============================================================================
//  TIMER LOOP
// ============================================================================
setInterval(() => {
  Object.values(state.mats).forEach(m => {
    if (m.running) m.time++;
  });
  io.emit("stateUpdate", state);
}, 1000);

// ============================================================================
//  START SERVER
// ============================================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Matside server running on port ${PORT}`);
});
