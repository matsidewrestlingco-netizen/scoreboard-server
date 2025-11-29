// server.js (multi-mat version)
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

function createMatState() {
  return {
    player1: 0,
    player2: 0,

    redName: "RED WRESTLER",
    greenName: "GREEN WRESTLER",

    period: 1,
    periodLength: 120,   // seconds
    timeRemaining: 120,
    isRunning: false,
    autoAdvance: true
  };
}

let state = {
  mats: {
    1: createMatState(),
    2: createMatState(),
    3: createMatState(),
    4: createMatState()
  }
};

let timers = {
  1: null,
  2: null,
  3: null,
  4: null
};

// Express Route
app.get("/", (req, res) => {
  res.send("Multi-mat Matside Server Running");
});

// Socket events
io.on("connection", socket => {
  socket.emit("stateUpdate", state);

  // Start timer
  socket.on("startPeriod", ({ mat }) => {
    const m = state.mats[mat];
    if (!m || m.isRunning) return;

    m.isRunning = true;

    timers[mat] = setInterval(() => {
      m.timeRemaining--;

      if (m.timeRemaining <= 0) {
        m.timeRemaining = 0;
        m.isRunning = false;
        clearInterval(timers[mat]);

        io.emit("buzzer", { mat });

        if (m.autoAdvance) {
          m.period++;
          m.timeRemaining = m.periodLength;
        }
      }

      io.emit("stateUpdate", state);
    }, 1000);
  });

  // Stop Timer
  socket.on("stopTimer", ({ mat }) => {
    const m = state.mats[mat];
    if (!m) return;

    m.isRunning = false;
    clearInterval(timers[mat]);
    io.emit("stateUpdate", state);
  });

  // Reset Timer
  socket.on("resetTimer", ({ mat }) => {
    const m = state.mats[mat];
    if (!m) return;

    m.timeRemaining = m.periodLength;
    m.isRunning = false;
    clearInterval(timers[mat]);

    io.emit("stateUpdate", state);
  });

  // Change period length
  socket.on("setPeriodLength", ({ mat, seconds }) => {
    const m = state.mats[mat];
    m.periodLength = seconds;
    m.timeRemaining = seconds;

    io.emit("stateUpdate", state);
  });

  // Toggle auto-advance
  socket.on("toggleAutoAdvance", ({ mat, value }) => {
    state.mats[mat].autoAdvance = value;
    io.emit("stateUpdate", state);
  });

  // Add scoring
  socket.on("addPoints", ({ mat, wrestler, points }) => {
    const m = state.mats[mat];
    if (wrestler === "red") m.player1 += points;
    if (wrestler === "green") m.player2 += points;
    io.emit("stateUpdate", state);
  });

  // Manual score reset
  socket.on("resetScores", ({ mat }) => {
    const m = state.mats[mat];
    m.player1 = 0;
    m.player2 = 0;
    io.emit("stateUpdate", state);
  });

  // Set names
  socket.on("setNames", ({ mat, red, green }) => {
    const m = state.mats[mat];
    m.redName = red;
    m.greenName = green;

    io.emit("stateUpdate", state);
  });

  // Set period number manually
  socket.on("setPeriod", ({ mat, value }) => {
    state.mats[mat].period = value;
    io.emit("stateUpdate", state);
  });

  // Buzzer test
  socket.on("playBuzzer", ({ mat }) => {
    io.emit("buzzer", { mat });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log("Multi-mat server running on " + PORT));
