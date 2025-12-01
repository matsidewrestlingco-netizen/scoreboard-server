// ===============================================================
// Matside Scoreboard Server — v2.12 Device Monitoring Upgrade
// ===============================================================

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const fetch = require("node-fetch");
const { Octokit } = require("@octokit/rest");

require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET","POST"]
  }
});

// =========================================================
// STATE (same as your existing)
// =========================================================
let mats = {
  1: { time: 60, running: false, period: 1, red: 0, green: 0 },
  2: { time: 60, running: false, period: 1, red: 0, green: 0 },
  3: { time: 60, running: false, period: 1, red: 0, green: 0 },
  4: { time: 60, running: false, period: 1, red: 0, green: 0 }
};

// =========================================================
// NEW: DEVICE REGISTRY
// =========================================================
let devices = {};  
// devices[socket.id] = { type, mat, lastHeartbeat }

// =========================================================
// DEVICE HEARTBEAT CLEANER
// =========================================================
setInterval(() => {
  const now = Date.now();
  let changed = false;

  for (const [id, dev] of Object.entries(devices)) {
    if (now - dev.lastHeartbeat > 15000) {
      dev.online = false;
      changed = true;
    }
  }

  if (changed) broadcastDeviceStatus();
}, 5000);

// =========================================================
// HELPER — BROADCAST DEVICE STATUS
// =========================================================
function broadcastDeviceStatus() {
  const list = Object.entries(devices).map(([id, d]) => ({
    id,
    type: d.type,
    mat: d.mat,
    online: d.online,
    lastSeen: d.lastHeartbeat
  }));

  io.emit("deviceStatusUpdate", list);
}

// =========================================================
// SOCKET.IO
// =========================================================
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // ============================================
  // NEW: DEVICE REGISTER
  // ============================================
  socket.on("registerDevice", ({ type, mat }) => {
    devices[socket.id] = {
      type,
      mat,
      lastHeartbeat: Date.now(),
      online: true
    };

    broadcastDeviceStatus();
    console.log(`Device registered: ${socket.id} (${type}, mat ${mat})`);
  });

  // ============================================
  // NEW: HEARTBEAT
  // ============================================
  socket.on("heartbeat", () => {
    if (devices[socket.id]) {
      devices[socket.id].lastHeartbeat = Date.now();
      devices[socket.id].online = true;
      broadcastDeviceStatus();
    }
  });

  // ============================================
  // TIMER LOOP SAME AS BEFORE
  // ============================================
  const timer = setInterval(() => {
    Object.keys(mats).forEach(mat => {
      const m = mats[mat];
      if (m.running && m.time > 0) {
        m.time -= 1;

        // AUTO PERIOD PROGRESSION
        if (m.time === 0 && m.period < 3) {
          m.period++;
          m.time = 60;
        }

        if (m.time === 0 && m.period === 3) {
          // End regulation — winner logic stays in client for now
        }
      }
    });

    io.emit("stateUpdate", { mats });
  }, 1000);

  // ============================================
  // SCORING EVENTS
  // ============================================
  socket.on("addPoints", ({ mat, color, pts }) => {
    mats[mat][color] += pts;
    io.emit("stateUpdate", { mats });
  });

  socket.on("subPoint", ({ mat, color }) => {
    mats[mat][color] = Math.max(0, mats[mat][color] - 1);
    io.emit("stateUpdate", { mats });
  });

  socket.on("updateState", ({ mat, updates }) => {
    mats[mat] = { ...mats[mat], ...updates };
    io.emit("stateUpdate", { mats });
  });

  socket.on("resetMat", ({ mat }) => {
    mats[mat] = { time: 60, running: false, period: 1, red: 0, green: 0 };
    io.emit("stateUpdate", { mats });
  });

  // ============================================
  // MATCH FINAL API LOG (unchanged from your build)
  // ============================================
  socket.on("logMatchResult", (payload) => {
    console.log("Match result:", payload);
  });

  // ============================================
  // ON DISCONNECT
  // ============================================
  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    if (devices[socket.id]) {
      devices[socket.id].online = false;
    }
    broadcastDeviceStatus();
  });
});

// =========================================================
// API: GET DEVICE STATUS (for hub.html)
// =========================================================
app.get("/device-status", (req, res) => {
  const list = Object.entries(devices).map(([id, d]) => ({
    id,
    type: d.type,
    mat: d.mat,
    online: d.online,
    lastSeen: d.lastHeartbeat
  }));

  res.json(list);
});

// =========================================================
// START SERVER
// =========================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Matside Server running on ${PORT}`)
);
