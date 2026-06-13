const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const countries = require("world-countries");

app.use(express.static("public"));

const flags = countries
    .filter(c => c.cca2 && c.name && c.name.common)
    .map(c => ({
        country: c.name.common,
        aliases: [
            c.name.common,
            c.name.official,
            ...(c.altSpellings || [])
        ].map(x => x.toLowerCase()),
        image: `https://flagcdn.com/w320/${c.cca2.toLowerCase()}.png`
    }));

const rooms = {};

function makeRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function getPublicRoom(room) {
    return {
        code: room.code,
        players: room.players.length,
        scores: room.scores,
        skipVotes: room.skipVotes.size
    };
}

function newFlag(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.currentFlag = flags[Math.floor(Math.random() * flags.length)];
    room.skipVotes.clear();

    io.to(roomCode).emit("newFlag", {
        image: room.currentFlag.image,
        scores: room.scores,
        skipVotes: 0
    });
}

io.on("connection", socket => {
    socket.on("createRoom", () => {
        let code = makeRoomCode();

        while (rooms[code]) {
            code = makeRoomCode();
        }

        rooms[code] = {
            code,
            players: [socket.id],
            scores: { [socket.id]: 0 },
            currentFlag: null,
            skipVotes: new Set(),
            gameOver: false
        };

        socket.join(code);
        socket.data.roomCode = code;

        socket.emit("roomCreated", {
            code,
            playerNumber: 1
        });

        io.to(code).emit("roomUpdate", getPublicRoom(rooms[code]));
    });

    socket.on("joinRoom", code => {
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

        socket.emit("roomJoined", {
            code,
            playerNumber: 2
        });

        io.to(code).emit("roomUpdate", getPublicRoom(room));

        if (room.players.length === 2) {
            newFlag(code);
        }
    });

    socket.on("guess", guess => {
        const code = socket.data.roomCode;
        const room = rooms[code];

        if (!room || !room.currentFlag || room.gameOver) return;

        const cleanGuess = String(guess).trim().toLowerCase();

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

    socket.on("disconnect", () => {
        const code = socket.data.roomCode;
        const room = rooms[code];

        if (!room) return;

        room.players = room.players.filter(id => id !== socket.id);
        delete room.scores[socket.id];
        room.skipVotes.delete(socket.id);

        if (room.players.length === 0) {
            delete rooms[code];
            return;
        }

        room.currentFlag = null;
        room.gameOver = false;

        io.to(code).emit("playerLeft");
        io.to(code).emit("roomUpdate", getPublicRoom(room));
    });
});

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log(`Game running on port ${PORT}`);
});