
"use strict";

/* =====================================================
   CHESS GAME — APP.JS
   Требуется chess.js 0.10.3 из index.html
===================================================== */

const $ = (id) => document.getElementById(id);

const PIECES = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }
};

const BOTS = {
  chatgpt: {
    name: "ChatGPT",
    elo: 9999,
    avatar: "🤖",
    description: "Сильнейший соперник · Stockfish"
  },
  alifka: {
    name: "Алифка",
    elo: -1,
    avatar: "👃",
    description: "Ходит почти случайно"
  },
  alikhan: {
    name: "Алихан",
    elo: 400,
    avatar: "🧑",
    description: "Любитель шахмат"
  },
  toxic: {
    name: "Токсик",
    elo: 250,
    avatar: "😈",
    description: "Играет неплохо, но ошибается"
  },
  batik: {
    name: "Батик",
    elo: 20,
    avatar: "🐶",
    description: "Мопс, который знает правила"
  }
};

const STORAGE_KEY = "chess_arena_profile_v1";

let chess;
let selectedSquare = null;
let legalTargets = [];
let currentBot = "chatgpt";
let playerColor = "w";
let botThinking = false;
let gameFinished = false;
let moveRecords = [];
let positionBeforePlayerMove = null;
let stockfishWorker = null;
let stockfishReady = false;
let stockfishPending = null;
let stockfishTimer = null;

let profile = loadProfile();

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved.rating === "number") {
      return {
        rating: saved.rating,
        wins: saved.wins || 0,
        losses: saved.losses || 0,
        draws: saved.draws || 0,
        games: saved.games || 0
      };
    }
  } catch (error) {
    console.warn("Не удалось загрузить профиль:", error);
  }

  return {
    rating: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    games: 0
  };
}

function saveProfile() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (error) {
    console.warn("Не удалось сохранить профиль:", error);
  }
}

function updateProfileUI() {
  $("rating").textContent = profile.rating;
  $("wins").textContent = profile.wins;
  $("losses").textContent = profile.losses;
  $("draws").textContent = profile.draws;
  $("games").textContent = profile.games;
}

function setStatus(message) {
  $("game-status").textContent = message;
}

function getSquareName(row, col) {
  return "abcdefgh"[col] + (8 - row);
}

function getCoordinates(square) {
  return {
    row: 8 - Number(square[1]),
    col: "abcdefgh".indexOf(square[0])
  };
}

function renderBoard() {
  const boardElement = $("chessboard");
  boardElement.innerHTML = "";

  const board = chess.board();

  for (let visualRow = 0; visualRow < 8; visualRow++) {
    for (let visualCol = 0; visualCol < 8; visualCol++) {
      let row = visualRow;
      let col = visualCol;

      if (playerColor === "b") {
        row = 7 - visualRow;
        col = 7 - visualCol;
      }

      const squareName = getSquareName(row, col);
      const piece = board[row][col];

      const square = document.createElement("button");
      square.type = "button";
      square.className =
        "square " + ((row + col) % 2 === 0 ? "light" : "dark");

      square.dataset.square = squareName;
      square.setAttribute("aria-label", squareName);

      if (piece) {
        square.textContent = PIECES[piece.color][piece.type];
        square.classList.add(piece.color === "w" ? "white-piece" : "black-piece");
      }

      if (selectedSquare === squareName) {
        square.classList.add("selected");
      }

      if (legalTargets.includes(squareName)) {
        const targetPiece = chess.get(squareName);
        square.classList.add(targetPiece ? "capture" : "possible");
      }

      square.addEventListener("click", () => onSquareClick(squareName));

      boardElement.appendChild(square);
    }
  }
}

function renderMoves() {
  const element = $("moves");
  element.innerHTML = "";

  const history = chess.history();

  if (!history.length) {
    element.textContent = "Пока нет ходов";
    return;
  }

  for (let i = 0; i < history.length; i += 2) {
    const line = document.createElement("div");
    line.className = "move-line";

    const number = document.createElement("span");
    number.textContent = `${Math.floor(i / 2) + 1}.`;

    const white = document.createElement("span");
    white.textContent = history[i];

    const black = document.createElement("span");
    black.textContent = history[i + 1] || "";

    line.append(number, white, black);
    element.appendChild(line);
  }

  element.scrollTop = element.scrollHeight;
}

function renderOpponent() {
  const bot = BOTS[currentBot];
  $("opponent").textContent =
    `${bot.avatar} ${bot.name} · ELO ${bot.elo}`;
}

function clearSelection() {
  selectedSquare = null;
  legalTargets = [];
}

function onSquareClick(square) {
  if (botThinking || gameFinished || chess.turn() !== playerColor) {
    return;
  }

  const piece = chess.get(square);

  if (selectedSquare) {
    const possible = legalTargets.includes(square);

    if (possible) {
      makePlayerMove(selectedSquare, square);
      return;
    }

    if (piece && piece.color === playerColor) {
      selectSquare(square);
      return;
    }

    clearSelection();
    renderBoard();
    return;
  }

  if (piece && piece.color === playerColor) {
    selectSquare(square);
  }
}

function selectSquare(square) {
  selectedSquare = square;

  legalTargets = chess
    .moves({ square, verbose: true })
    .map(move => move.to);

  renderBoard();
}

function makePlayerMove(from, to) {
  positionBeforePlayerMove = chess.fen();

  const move = chess.move({
    from,
    to,
    promotion: "q"
  });

  clearSelection();

  if (!move) {
    renderBoard();
    return;
  }

  moveRecords.push({
    san: move.san,
    color: "player",
    fen: chess.fen()
  });

  afterMove();
}

function afterMove() {
  renderBoard();
  renderMoves();

  if (checkGameOver()) return;

  if (chess.turn() !== playerColor) {
    botThinking = true;
    setStatus(`${BOTS[currentBot].name} думает...`);

    setTimeout(() => {
      makeBotMove();
    }, 350);
  } else {
    setStatus(chess.in_check() ? "Шах! Твой ход." : "Твой ход.");
  }
}

function checkGameOver() {
  if (!chess.game_over()) return false;

  gameFinished = true;
  botThinking = false;

  let result;
  let title;

  if (chess.in_checkmate()) {
    const playerWon = chess.turn() !== playerColor;

    if (playerWon) {
      result = "win";
      title = "Победа! Ты выиграл 🎉";
    } else {
      result = "loss";
      title = "Поражение. Бот победил.";
    }
  } else {
    result = "draw";
    title = "Ничья!";
  }

  applyRating(result);
  showReport(result, title);
  setStatus(title);

  return true;
}

function getRatingChange(result) {
  if (currentBot === "alifka") return 0;

  if (result === "draw") return 0;

  if (currentBot === "batik") {
    return result === "win" ? 3 : -10;
  }

  if (result === "win") return 8;

  return Math.random() < 0.5 ? -9 : -10;
}

function applyRating(result) {
  const change = getRatingChange(result);

  profile.games++;

  if (result === "win") profile.wins++;
  if (result === "loss") profile.losses++;
  if (result === "draw") profile.draws++;

  profile.rating += change;

  saveProfile();
  updateProfileUI();

  return change;
}

/* =====================================================
   БОТЫ
===================================================== */

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function getAllLegalMoves() {
  return chess.moves({ verbose: true });
}

function moveScore(move) {
  let score = Math.random() * 2;

  const values = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 20000
  };

  if (move.captured) {
    score += values[move.captured] || 0;
  }

  if (move.promotion) {
    score += 800;
  }

  if (move.san && move.san.includes("+")) {
    score += 60;
  }

  if (move.san && move.san.includes("#")) {
    score += 100000;
  }

  return score;
}

function chooseWeakMove(moves, strength) {
  const scored = moves
    .map(move => ({
      move,
      score: moveScore(move)
    }))
    .sort((a, b) => b.score - a.score);

  const topCount = Math.max(
    1,
    Math.ceil(scored.length * strength)
  );

  return randomItem(scored.slice(0, topCount)).move;
}

function chooseAlifkaMove(moves) {
  return randomItem(moves);
}

function chooseAlikhanMove(moves) {
  return chooseWeakMove(moves, 0.45);
}

function chooseToxicMove(moves) {
  return chooseWeakMove(moves, 0.7);
}

function chooseBatikMove(moves) {
  return randomItem(moves);
}

/* =====================================================
   STOCKFISH
   Сильный бот использует онлайн-движок.
   Если он недоступен, игра продолжится с запасным
   алгоритмом — это не полноценный Stockfish.
===================================================== */

function initStockfish() {
  if (stockfishWorker) return;

  try {
    stockfishWorker = new Worker(
      "https://cdn.jsdelivr.net/npm/stockfish@16.0.0/stockfish.js"
    );

    stockfishWorker.onmessage = (event) => {
      const message = String(event.data || "");

      if (message.includes("uciok")) {
        stockfishReady = true;
        stockfishWorker.postMessage("isready");
        return;
      }

      if (message.includes("bestmove")) {
        const match = message.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);

        if (stockfishPending) {
          clearTimeout(stockfishTimer);

          const resolve = stockfishPending;
          stockfishPending = null;

          resolve(match ? match[1] : null);
        }
      }
    };

    stockfishWorker.onerror = () => {
      stockfishReady = false;
      if (stockfishPending) {
        clearTimeout(stockfishTimer);
        const resolve = stockfishPending;
        stockfishPending = null;
        resolve(null);
      }
    };

    stockfishWorker.postMessage("uci");
  } catch (error) {
    console.warn("Stockfish недоступен:", error);
  }
}

function askStockfish() {
  return new Promise((resolve) => {
    if (!stockfishWorker) {
      resolve(null);
      return;
    }

    stockfishPending = resolve;

    stockfishTimer = setTimeout(() => {
      if (stockfishPending) {
        const callback = stockfishPending;
        stockfishPending = null;
        callback(null);
      }
    }, 12000);

    stockfishWorker.postMessage("position fen " + chess.fen());
    stockfishWorker.postMessage("go depth 12");
  });
}

function uciToMove(uci) {
  if (!uci || uci.length < 4) return null;

  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4] || "q"
  };
}

async function chooseChatGPTMove(moves) {
  const uci = await askStockfish();

  if (uci) {
    const move = uciToMove(uci);

    const legal = moves.find(candidate =>
      candidate.from === move.from &&
      candidate.to === move.to &&
      (!move.promotion || candidate.promotion === move.promotion)
    );

    if (legal) return legal;
  }

  // Запасной вариант, если Stockfish не загрузился.
  // Это эвристический ход, а не уровень ELO 9999.
  return chooseWeakMove(moves, 0.15);
}

async function makeBotMove() {
  if (gameFinished || chess.game_over()) {
    botThinking = false;
    return;
  }

  const moves = getAllLegalMoves();

  if (!moves.length) {
    botThinking = false;
    checkGameOver();
    return;
  }

  let chosenMove;

  if (currentBot === "chatgpt") {
    chosenMove = await chooseChatGPTMove(moves);
  } else if (currentBot === "alifka") {
    chosenMove = chooseAlifkaMove(moves);
  } else if (currentBot === "alikhan") {
    chosenMove = chooseAlikhanMove(moves);
  } else if (currentBot === "toxic") {
    chosenMove = chooseToxicMove(moves);
  } else {
    chosenMove = chooseBatikMove(moves);
  }

  if (gameFinished) {
    botThinking = false;
    return;
  }

  if (!chosenMove) {
    botThinking = false;
    return;
  }

  const move = chess.move({
    from: chosenMove.from,
    to: chosenMove.to,
    promotion: chosenMove.promotion || "q"
  });

  if (move) {
    moveRecords.push({
      san: move.san,
      color: "bot",
      fen: chess.fen()
    });
  }

  botThinking = false;
  afterMove();
}

/* =====================================================
   ОТЧЁТ ПОСЛЕ ПАРТИИ
===================================================== */

function showReport(result, title) {
  const report = $("report");
  const change = getLastRatingChange();

  const resultText = {
    win: "Ты победил!",
    loss: "Ты проиграл.",
    draw: "Ничья."
  };

  let details = "";

  if (result === "win") {
    details = "Отличная работа! Ты смог довести партию до победы.";
  } else if (result === "loss") {
    details = "Не расстраивайся. Каждая партия помогает лучше понимать шахматы.";
  } else {
    details = "Неплохой результат. В следующий раз попробуй найти возможность для победы.";
  }

  let ratingText = "Рейтинг не изменился.";

  if (change > 0) ratingText = `Рейтинг: +${change}`;
  if (change < 0) ratingText = `Рейтинг: ${change}`;

  if (currentBot === "alifka") {
    ratingText = "Против Алифки рейтинг не меняется.";
  }

  report.innerHTML = "";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const paragraph = document.createElement("p");
  paragraph.textContent = details;

  const rating = document.createElement("p");
  rating.textContent = ratingText;

  const moves = document.createElement("p");
  moves.textContent = `Всего ходов: ${chess.history().length}`;

  const note = document.createElement("p");
  note.textContent =
    "Это базовый отчёт партии. Подробный анализ лучших ходов и ошибок добавим отдельно.";

  report.append(heading, paragraph, rating, moves, note);
  report.style.display = "block";
}

let lastRatingChange = 0;

function getLastRatingChange() {
  return lastRatingChange;
}

/* =====================================================
   УПРАВЛЕНИЕ ИГРОЙ
===================================================== */

function startGame(botId = currentBot) {
  if (!BOTS[botId]) return;

  currentBot = botId;
  playerColor = Math.random() < 0.5 ? "w" : "b";

  chess = new Chess();
  selectedSquare = null;
  legalTargets = [];
  moveRecords = [];
  botThinking = false;
  gameFinished = false;
  positionBeforePlayerMove = null;
  lastRatingChange = 0;

  $("report").style.display = "none";
  $("report").innerHTML = "";

  renderOpponent();
  renderBoard();
  renderMoves();

  if (playerColor === "w") {
    setStatus("Твой ход. Ты играешь белыми.");
  } else {
    setStatus("Ты играешь чёрными. Бот ходит первым.");
    botThinking = true;
    setTimeout(makeBotMove, 400);
  }
}

function undoMove() {
  if (botThinking || !chess || gameFinished) return;

  const history = chess.history();

  if (!history.length) return;

  // Возвращаем ход бота и затем ход игрока,
  // если бот уже успел ответить.
  if (chess.turn() === playerColor) {
    chess.undo();

    if (chess.history().length) {
      chess.undo();
    }
  } else {
    chess.undo();
  }

  moveRecords = moveRecords.slice(0, chess.history().length);

  clearSelection();
  renderBoard();
  renderMoves();
  setStatus("Ход отменён. Твой ход.");
}

function flipBoard() {
  playerColor = playerColor === "w" ? "b" : "w";
  renderBoard();
}

function setupBotButtons() {
  document.querySelectorAll("[data-bot]").forEach(button => {
    button.addEventListener("click", () => {
      const botId = button.dataset.bot;
      startGame(botId);
    });
  });
}

function setupButtons() {
  $("new-game").addEventListener("click", () => {
    startGame(currentBot);
  });

  $("undo").addEventListener("click", undoMove);
  $("flip").addEventListener("click", flipBoard);
}

/* =====================================================
   ЗАПУСК
===================================================== */

function init() {
  if (typeof Chess !== "function") {
    setStatus("Не загрузились шахматные правила. Проверь интернет.");
    return;
  }

  updateProfileUI();
  setupBotButtons();
  setupButtons();

  initStockfish();
  startGame("chatgpt");
}

document.addEventListener("DOMContentLoaded", init);
