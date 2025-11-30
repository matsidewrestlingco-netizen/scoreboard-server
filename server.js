// ============================================================================
//  Matside Scoreboard Server
//  Updated with:
//    ✔ Full CORS support (GET/POST + preflight)
//    ✔ Persistent event storage (/var/data/events.json)
//    ✔ Safe fallbacks for first-run initialization
//    ✔ Socket.IO real-time sync
//    ✔ Clean Express routing
// ============================================================================

const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

// ============================================================================
//  CORS CONFIG (Fixes your GitHub Pages → Render requests)
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

// Preflight support
app.options("*", cors());

// ============================================================================
//  SOCKET.IO
// ============================================================================
const io = socketio(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ============================================================================
//  PATHS
// ============================================================================
const PUBLIC_DIR = path.join(__dirname, "public");

const PERSIST_EVENTS_PATH = "/var/data/events.json";          // Render persistent disk
const DEFAULT_EVENTS_PATH = path.join(PUBLIC_DIR, "events.json");

// ============================================================================
//  INITIALIZE EVENTS (first-time setup)
// ============================================================================
(function initializeEvents() {
  try {
    if (!fs.existsSync(PERSIST_EVENTS_PATH)) {
      console.log("[Events] No persistent events.json found. Creating one.");

      let defaultEvents = { events: [] };

      // If a default exists in /public, use that
      if (fs.existsSync(DEFAULT_EVENTS_PATH)) {
        defaultEvents = JSON.parse(fs.readFileSync(DEFAULT_EVENTS_PATH, "utf8"));
      }

      fs.writeFileSync(PERSIST_EVENTS_PATH, JSON.stringify(defaultEvents, null, 2));

      console.log("[Events] /var/data/events.json created successfully.");
    } else {
      console.log("[Events] Persistent events.json found.");
    }
  } catch (err) {
    console.error("[Events] Initialization error:", err);
  }
})();

// ============================================================================
//  EXPRESS MIDDLEWARE & STATIC FILES
// ============================================================================
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ============================================================================
//  ROUTE: GET /events.json
// ============================================================================
app.get("/events.json", (req, res) => {
  if (fs.existsSync(PERSIST_EVENTS_PATH)) {
    return res.sendFile(PERSIST_EVENTS_PATH);
  }
  return res.sendFile(DEFAULT_EVENTS_PATH);
});

// ============================================================================
//  ROUTE: POST /save-events
// ============================================================================
app.post("/save-events", (req, res) => {
  const eventsData = req.body;

  if (!eventsData || typeof eventsData !== "object") {
    return res.status(400).json({ ok: false, error: "Invalid events data." });
  }

  fs.writeFile(PERSIST_EVENTS_PATH, JSON.stringify(eventsData, null, 2), (err) => {
    if (err) {
      console.error("[Events] Write error:", err);
      return res.status(500).json({ ok: false, error: err.toString() });
    }

    console.log("[Events] events.json updated successfully.");
    res.json({ ok: true });
  });
});

// ============================================================================
//  SCOREBOARD STATE
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
//  SOCKET.IO EVENT HANDLERS
// ============================================================================
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.emit("stateUpdate", state);

  socket.on("timerStart", ({ mat }) => {
    if (state.mats[mat]) {
      state.mats[mat].running = true;
      io.emit("stateUpdate", state);
    }
  });

  socket.on("timerStop", ({ mat }) => {
    if (state.mats[mat]) {
      state.mats[mat].running = false;
      io.emit("stateUpdate", state);
    }
  });

  socket.on("timerReset", ({ mat }) => {
    if (state.mats[mat]) {
      state.mats[mat].time = 0;
      io.emit("stateUpdate", state);
    }
  });

  socket.on("addPoints", ({ mat, color, pts }) => {
    if (state.mats[mat]) {
      state.mats[mat][color] += pts;
      io.emit("stateUpdate", state);
    }
  });

  socket.on("subPoint", ({ mat, color }) => {
    if (state.mats[mat]) {
      state.mats[mat][color] = Math.max(0, state.mats[mat][color] - 1);
      io.emit("stateUpdate", state);
    }
  });

  socket.on("updateState", ({ mat, updates }) => {
    if (state.mats[mat]) {
      Object.assign(state.mats[mat], updates);
      io.emit("stateUpdate", state);
    }
  });

  socket.on("setPeriodLength", ({ mat, seconds }) => {
    if (state.mats[mat]) {
      state.mats[mat].periodLength = seconds;
      io.emit("stateUpdate", state);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// ============================================================================
//  TIMER LOOP
// ============================================================================
setInterval(() => {
  Object.values(state.mats).forEach((m) => {
    if (m.running) {
      m.time++;
    }
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
