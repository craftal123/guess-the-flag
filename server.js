const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    pingTimeout: 20000,
    pingInterval: 25000
});

const countries = require("world-countries");

app.use(express.static("public"));

function normalizeText(text) {
    return String(text)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ı/g, "i")
        .replace(/ø/g, "o")
        .replace(/æ/g, "ae")
        .replace(/œ/g, "oe")
        .trim();
}

const flags = countries
    .filter(c => c.cca2 && c.name && c.name.common)
    .map(c => ({
        country: c.name.common,
        aliases: [
            c.name.common,
            c.name.official,
            ...(c.altSpellings || [])
        ].map(normalizeText),
        image: `https://flagcdn.com/w320/${c.cca2.toLowerCase()}.png`
    }));

const turkey = flags.find(f => f.country === "Turkey" || f.country === "Türkiye");
if (turkey) {
    turkey.aliases.push("turkey", "turkiye");
}

const rooms = {};

function makeRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function roomUpdate(code) {
    const room = rooms[code];
    if (!room) return;

    io.to(code).emit("roomUpdate", {
        code,
        players: room.players.length,
        scores: room.scores,
        skipVotes: room.skipVotes.size
    });
}

function leaveRoom(socket) {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];

    room.players = room.players.filter(id => id !== socket.id);
    delete room.scores[socket.id];
    room.skipVotes.delete(socket.id);

    socket.leave(code);
    socket.data.roomCode = null;

    if (room.players.length === 0) {
        delete rooms[code];
        return;
    }

    room.currentFlag = null;
    room.gameOver = false;

    io.to(code).emit("playerLeft");
    roomUpdate(code);
}

function newFlag(code) {
    const room = rooms[code];
    if (!room || room.players.length < 2) return;

    if (room.usedFlags.size >= flags.length) {
        room.usedFlags.clear();
    }

    const availableFlags = flags.filter(flag => !room.usedFlags.has(flag.country));

    room.currentFlag = availableFlags[Math.floor(Math.random() * availableFlags.length)];
    room.usedFlags.add(room.currentFlag.country);
    room.skipVotes.clear();

    io.to(code).emit("newFlag", {
        image: room.currentFlag.image,
        scores: room.scores,
        skipVotes: 0
    });
}

io.on("connection", socket => {
    socket.on("createRoom", () => {
        leaveRoom(socket);

        let code = makeRoomCode();
        while (rooms[code]) code = makeRoomCode();

        rooms[code] = {
            players: [socket.id],
            scores: { [socket.id]: 0 },
            skipVotes: new Set(),
            currentFlag: null,
            gameOver: false,
            usedFlags: new Set()
        };

        socket.join(code);
        socket.data.roomCode = code;

        socket.emit("roomCreated", { code, playerNumber: 1 });
        roomUpdate(code);
    });

    socket.on("joinRoom", code => {
        leaveRoom(socket);

        code = String(code).trim().toUpperCase();
        const room = rooms[code];

        if (!room) {
            socket.emit("errorMessage", "Room not found");
            return;
        }

        if (room.players.length >= 2) {
            socket.emit("errorMessage", "Room is full");
            return;
        }

        room.players.push(socket.id);
        room.scores[socket.id] = 0;

        socket.join(code);
        socket.data.roomCode = code;

        socket.emit("roomJoined", { code, playerNumber: 2 });
        roomUpdate(code);

        if (room.players.length === 2) {
            newFlag(code);
        }
    });

    socket.on("guess", guess => {
        const code = socket.data.roomCode;
        const room = rooms[code];

        if (!room || !room.currentFlag || room.gameOver) return;

        const cleanGuess = normalizeText(guess);

        if (room.currentFlag.aliases.includes(cleanGuess)) {
            room.scores[socket.id]++;

            io.to(code).emit("correct", {
                player: socket.id,
                answer: room.currentFlag.country,
                scores: room.scores
            });

            if (room.scores[socket.id] >= 10) {
                room.gameOver = true;
                io.to(code).emit("winner", socket.id);
            } else {
                setTimeout(() => newFlag(code), 1000);
            }
        }
    });

    socket.on("voteSkip", () => {
        const code = socket.data.roomCode;
        const room = rooms[code];

        if (!room || !room.currentFlag || room.gameOver) return;

        room.skipVotes.add(socket.id);
        io.to(code).emit("skipVotes", room.skipVotes.size);

        if (room.skipVotes.size >= room.players.length) {
            io.to(code).emit("skipped", room.currentFlag.country);
            setTimeout(() => newFlag(code), 1000);
        }
    });

    socket.on("leaveRoom", () => {
        leaveRoom(socket);
    });

    socket.on("disconnect", () => {
        leaveRoom(socket);
    });
});

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log(`Game running on port ${PORT}`);
});