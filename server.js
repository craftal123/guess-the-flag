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

let players = [];
let scores = {};
let currentFlag = null;
let skipVotes = new Set();
let gameOver = false;

function newFlag() {
    currentFlag = flags[Math.floor(Math.random() * flags.length)];
    skipVotes.clear();

    io.emit("newFlag", {
        image: currentFlag.image,
        scores,
        skipVotes: 0
    });
}

io.on("connection", socket => {
    if (players.length >= 2) {
        socket.emit("full");
        return;
    }

    players.push(socket.id);
    scores[socket.id] = 0;

    socket.emit("playerNumber", players.length);
    io.emit("players", players.length);

    if (players.length === 2) {
        newFlag();
    }

    socket.on("guess", guess => {
        if (!currentFlag || gameOver) return;

        const cleanGuess = guess.trim().toLowerCase();

        if (currentFlag.aliases.includes(cleanGuess)) {
            scores[socket.id]++;

            io.emit("correct", {
                player: socket.id,
                answer: currentFlag.country,
                scores
            });

            if (scores[socket.id] >= 10) {
                gameOver = true;
                io.emit("winner", socket.id);
            } else {
                setTimeout(newFlag, 1000);
            }
        }
    });

    socket.on("voteSkip", () => {
        if (!currentFlag || gameOver) return;

        skipVotes.add(socket.id);
        io.emit("skipVotes", skipVotes.size);

        if (skipVotes.size >= players.length) {
            io.emit("skipped", currentFlag.country);
            setTimeout(newFlag, 1000);
        }
    });

    socket.on("disconnect", () => {
        players = players.filter(id => id !== socket.id);
        delete scores[socket.id];
        skipVotes.delete(socket.id);

        gameOver = false;
        currentFlag = null;

        io.emit("players", players.length);
        io.emit("reset");
    });
});

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log(`Game running on port ${PORT}`);
});