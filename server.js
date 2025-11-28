{\rtf1\ansi\ansicpg1252\cocoartf2867
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 // server.js\
const express = require("express");\
const http = require("http");\
const \{ Server \} = require("socket.io");\
\
const app = express();\
const server = http.createServer(app);\
const io = new Server(server, \{\
  cors: \{\
    origin: "*", // allow Carrd or any website to connect\
  \},\
\});\
\
let state = \{\
  player1: 0,\
  player2: 0,\
  timer: 0,\
  isRunning: false,\
  winner: null,\
\};\
\
let timerInterval = null;\
\
// Send a quick test route\
app.get("/", (req, res) => \{\
  res.send("Scoreboard server is running!");\
\});\
\
io.on("connection", (socket) => \{\
  console.log("Client connected:", socket.id);\
\
  // Send current state to new clients\
  socket.emit("stateUpdate", state);\
\
  // Timer Start\
  socket.on("startTimer", () => \{\
    if (!state.isRunning) \{\
      state.isRunning = true;\
      timerInterval = setInterval(() => \{\
        state.timer++;\
        io.emit("stateUpdate", state);\
      \}, 1000);\
    \}\
  \});\
\
  // Timer Stop\
  socket.on("stopTimer", () => \{\
    state.isRunning = false;\
    clearInterval(timerInterval);\
    io.emit("stateUpdate", state);\
  \});\
\
  // Add Points\
  socket.on("addPoint", (player) => \{\
    if (player === "player1") state.player1++;\
    if (player === "player2") state.player2++;\
    io.emit("stateUpdate", state);\
  \});\
\
  // Declare Winner\
  socket.on("setWinner", (player) => \{\
    state.winner = player;\
    io.emit("stateUpdate", state);\
  \});\
\});\
\
const PORT = process.env.PORT || 3001;\
server.listen(PORT, () => console.log(`Server is running on port $\{PORT\}`));}