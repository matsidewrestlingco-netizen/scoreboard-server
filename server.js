// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// ------------------- SCOREBOARD STATE -------------------
let state = {
  player1: 0,
  player2: 0,

  mat: 1,
  period: 1,

  redName: "RED WRESTLER",
  greenName: "GREEN WRESTLER",

  periodLength: 120, // default 2 minutes (120 sec)
  timeRemaining: 120,
  isRunning: false,
};

let timerInterval = null;

app.get("/", (req, res) => {
  res.send("Scoreboard server running.");
});

// ------------------- SOCKET EVENTS -------------------
io.on("connection", (socket) => {
  socket.emit("stateUpdate", state);

  // Start countdown
  socket.on("startPeriod", () => {
    if (state.isRunning) return;
    state.isRunning = true;

    timerInterval = setInterval(() => {
      state.timeRemaining--;

      if (state.timeRemaining <= 0) {
        state.timeRemaining = 0;
        state.isRunning = false;
        clearInterval(timerInterval);
      }

      io.emit("stateUpdate", state);
    }, 1000);
  });

  // Stop timer
  socket.on("stopTimer", () => {
    state.isRunning = false;
    clearInterval(timerInterval);
    io.emit("stateUpdate", state);
  });

  // Reset timer
  socket.on("resetTimer", () => {
    state.timeRemaining = state.periodLength;
    state.isRunning = false;
    clearInterval(timerInterval);
    io.emit("stateUpdate", state);
  });

  // Set custom period length
  socket.on("setPeriodLength", (seconds) => {
    state.periodLength = seconds;
    state.timeRemaining = seconds;
    io.emit("stateUpdate", state);
  });

  // Score controls
  socket.on("addPoint", (p) => {
    if (p === "player1") state.player1++;
    if (p === "player2") state.player2++;
    io.emit("stateUpdate", state);
  });

  socket.on("subtractPoint", (p) => {
    if (p === "player1" && state.player1 > 0) state.player1--;
    if (p === "player2" && state.player2 > 0) state.player2--;
    io.emit("stateUpdate", state);
  });

  socket.on("resetScores", () => {
    state.player1 = 0;
    state.player2 = 0;
    io.emit("stateUpdate", state);
  });

  // Match info
  socket.on("setMat", (v) => {
    state.mat = v;
    io.emit("stateUpdate", state);
  });

  socket.on("setPeriod", (v) => {
    state.period = v;
    io.emit("stateUpdate", state);
  });

  socket.on("setNames", (data) => {
    state.redName = data.red;
    state.greenName = data.green;
    io.emit("stateUpdate", state);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log("Server running on " + PORT));
