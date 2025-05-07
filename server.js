const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// State and user storage for each room
const roomStates = {};
const roomHosts = {};
const roomUsers = {}; // { roomId: [{ id: socket.id, name: username }, ...] }

// Home page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Create room
app.get('/create', (req, res) => {
    const video = req.query.video;
    const username = req.query.username || "Guest";
    if (!video) return res.send("Invalid video URL.");
    const roomId = nanoid(8);
    res.redirect(`/room/${roomId}?video=${encodeURIComponent(video)}&username=${encodeURIComponent(username)}`);
});

// Room page
app.get('/room/:room', (req, res) => {
    const roomId = req.params.room;
    const video = req.query.video;
    const subtitle = req.query.subtitle || "";
    const username = req.query.username || "Guest";
    if (!video) return res.send("Video URL not found.");

    let html = fs.readFileSync('public/room.html', 'utf8');
    html = html.replace(/{{roomId}}/g, roomId)
               .replace(/{{video}}/g, video)
               .replace(/{{username}}/g, username)
               .replace(/{{subtitle}}/g, subtitle);
    res.send(html);
});

function updateUserList(room) {
    const names = (roomUsers[room] || []).map(user => user.name);
    io.to(room).emit('userList', { users: names });
}

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        const room = data.room;
        const username = data.username || "Guest";
        socket.join(room);

        if (!roomHosts[room]) {
            roomHosts[room] = socket.id;
        }

        if (!roomUsers[room]) {
            roomUsers[room] = [];
        }
        roomUsers[room].push({ id: socket.id, name: username });

        socket.emit('role', { isHost: (roomHosts[room] === socket.id) });
        if (roomStates[room]) {
            socket.emit('stateUpdate', { room: room, state: roomStates[room] });
        }

        updateUserList(room);

        socket.emit('notification', "Welcome " + username + "!");
        socket.to(room).emit('notification', username + " has joined the room.");
    });

    socket.on('stateUpdate', (data) => {
        if (!data || !data.state) return;
        if (roomHosts[data.room] !== socket.id) return;
        roomStates[data.room] = data.state;
        socket.to(data.room).emit('stateUpdate', data);
    });

    socket.on('chatMessage', (data) => {
        io.to(data.room).emit('chatMessage', {
            username: data.username,
            message: data.message
        });
    });

    socket.on('disconnect', () => {
        for (const room in roomUsers) {
            if (!roomUsers[room]) continue;
            const userIndex = roomUsers[room].findIndex(u => u.id === socket.id);
            if (userIndex !== -1) {
                const username = roomUsers[room][userIndex].name;
                roomUsers[room].splice(userIndex, 1);
                updateUserList(room);
                io.to(room).emit('notification', username + " has left the room.");

                if (roomHosts[room] === socket.id) {
                    if (roomUsers[room].length > 0) {
                        roomHosts[room] = roomUsers[room][0].id;
                        io.to(roomHosts[room]).emit('notification', "You are now the Host.");
                    } else {
                        delete roomHosts[room];
                    }
                    roomUsers[room].forEach(user => {
                        io.to(user.id).emit('role', { isHost: (roomHosts[room] === user.id) });
                    });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
