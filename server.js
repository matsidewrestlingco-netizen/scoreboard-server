// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // allow Carrd or any website to connect
  },
});

let state = {
  player1: 0,
  player2: 0,
  timer: 0,
  isRunning: false,
  winner: null,
};

let timerInterval = null;

// Send a quick test route
app.get("/", (req, res) => {
  res.send("Scoreboard server is running!");
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Send current state to new clients
  socket.emit("stateUpdate", state);

  // Timer Start
  socket.on("startTimer", () => {
    if (!state.isRunning) {
      state.isRunning = true;
      timerInterval = setInterval(() => {
        state.timer++;
        io.emit("stateUpdate", state);
      }, 1000);
    }
  });

  // Timer Stop
  socket.on("stopTimer", () => {
    state.isRunning = false;
    clearInterval(timerInterval);
    io.emit("stateUpdate", state);
  });

  // Add Points
  socket.on("addPoint", (player) => {
    if (player === "player1") state.player1++;
    if (player === "player2") state.player2++;
    io.emit("stateUpdate", state);
  });

  // Declare Winner
  socket.on("setWinner", (player) => {
    state.winner = player;
    io.emit("stateUpdate", state);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
