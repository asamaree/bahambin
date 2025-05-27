const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Ensure the public/subtitles directory exists
const subtitlesDir = path.join(__dirname, 'public', 'subtitles');
if (!fs.existsSync(subtitlesDir)) {
    fs.mkdirSync(subtitlesDir, { recursive: true });
}

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));

// State and user storage for each room
const roomStates = {};
const roomHosts = {};
const roomUsers = {}; // { roomId: [{ id: socket.id, name: username }, ...] }
const roomMessages = {};
const messageReactions = {};

// Home page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Existing /create GET route
app.get('/create', (req, res) => {
    const video = req.query.video;
    const username = req.query.username || "Guest";
    const subtitle = req.query.subtitle || "";
    if (!video) return res.send("Invalid video URL.");
    const roomId = nanoid(8);
    res.redirect(`/room/${roomId}?video=${encodeURIComponent(video)}&username=${encodeURIComponent(username)}&subtitle=${encodeURIComponent(subtitle)}`);
});

// Route to handle SRT upload and room creation
app.post('/upload-and-create', upload.single('srtSubtitle'), (req, res) => {
    console.log('POST /upload-and-create received.'); // Log when request is received
    console.log('Request body:', req.body); // Log request body
    console.log('Request file:', req.file); // Log uploaded file info

    const video = req.body.video;
    const username = req.body.username || "Guest";
    let subtitleUrl = "";

    if (!video) {
        console.error('Video URL is missing.'); // Log error
        return res.status(400).send("Video URL is missing."); // Send 400 for bad request
    }

    if (req.file) {
        console.log('SRT file detected, starting conversion...');
        const srtFilePath = req.file.path;
        const uniqueSrtName = `${nanoid(12)}.srt`;
        const uniqueVttName = `${nanoid(12)}.vtt`;
        const tempSrtPath = path.join(__dirname, 'uploads', uniqueSrtName);
        const outputVttPath = path.join(subtitlesDir, uniqueVttName);

        try {
            fs.renameSync(srtFilePath, tempSrtPath);
            console.log(`Renamed temp file from ${srtFilePath} to ${tempSrtPath}`);
        } catch (renameError) {
            console.error(`Error renaming temp file: ${renameError}`);
            return res.status(500).send("Server error during file processing.");
        }


        const ffmpegCommand = `ffmpeg -i "${tempSrtPath}" -map 0:s:0 -c:s webvtt -f webvtt "${outputVttPath}"`;
        console.log(`Executing ffmpeg command: ${ffmpegCommand}`);

        exec(ffmpegCommand, (error, stdout, stderr) => {
            fs.unlink(tempSrtPath, (err) => {
                if (err) console.error(`Error deleting temp SRT file ${tempSrtPath}:`, err);
            });

            if (error) {
                console.error(`ffmpeg exec error: ${error}`);
                console.error(`ffmpeg stdout: ${stdout}`);
                console.error(`ffmpeg stderr: ${stderr}`);
                return res.status(500).send("Error converting subtitle. Please ensure ffmpeg is installed and the SRT file is valid. Check server logs for details.");
            }

            console.log(`Subtitle converted successfully: ${tempSrtPath} -> ${outputVttPath}`);
            subtitleUrl = `/subtitles/${uniqueVttName}`;

            const roomId = nanoid(8);
            const redirectUrl = `/room/${roomId}?video=${encodeURIComponent(video)}&username=${encodeURIComponent(username)}&subtitle=${encodeURIComponent(subtitleUrl)}`;
            console.log(`Redirecting to: ${redirectUrl}`);
            res.redirect(redirectUrl);
        });
    } else {
        console.log('No SRT file uploaded, creating room directly.');
        const roomId = nanoid(8);
        const redirectUrl = `/room/${roomId}?video=${encodeURIComponent(video)}&username=${encodeURIComponent(username)}`;
        console.log(`Redirecting to: ${redirectUrl}`);
        res.redirect(redirectUrl);
    }
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

// MODIFIED: Send currentHostId with userList
function updateUserList(room) {
    const users = roomUsers[room] || [];
    const currentHostId = roomHosts[room]; // Get current host ID
    io.to(room).emit('userList', { users: users, currentHostId: currentHostId });
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
        const existingUser = roomUsers[room].find(u => u.id === socket.id);
        if (!existingUser) {
            roomUsers[room].push({ id: socket.id, name: username });
        } else {
            existingUser.name = username;
        }


        socket.emit('role', { isHost: (roomHosts[room] === socket.id) });
        if (roomStates[room]) {
            socket.emit('stateUpdate', { room: room, state: roomStates[room] });
        }

        updateUserList(room);

        socket.emit('notification', "Welcome " + username + "!");
        socket.to(room).emit('notification', username + " has joined the room.");

        if (!roomMessages[room]) {
            roomMessages[room] = [];
        }
        socket.emit('initialChatState', {
            messages: roomMessages[room],
            reactions: messageReactions
        });
    });

    socket.on('stateUpdate', (data) => {
        if (!data || !data.state) return;
        if (roomHosts[data.room] !== socket.id) return;
        roomStates[data.room] = data.state;
        socket.to(data.room).emit('stateUpdate', data);
    });
    
    socket.on('chatMessage', (data) => {
        const senderIsHost = (roomHosts[data.room] === socket.id);
        const messageId = nanoid(10);

        const messageData = {
            id: messageId,
            username: data.username,
            message: data.message,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isHost: senderIsHost,
            repliedTo: data.repliedTo || null
        };

        if (!roomMessages[data.room]) {
            roomMessages[data.room] = [];
        }
        roomMessages[data.room].push(messageData);

        messageReactions[messageId] = {};

        io.to(data.room).emit('chatMessage', messageData);
    });

    socket.on('addReaction', (data) => {
        const { room, messageId, emoji } = data;
        const userId = socket.id;

        if (!messageReactions[messageId]) {
            console.warn(`Attempted to react to non-existent message: ${messageId}`);
            return;
        }

        if (!messageReactions[messageId][emoji]) {
            messageReactions[messageId][emoji] = { count: 0, users: [] };
        }

        const reaction = messageReactions[messageId][emoji];
        const userIndex = reaction.users.indexOf(userId);

        if (userIndex === -1) {
            reaction.count++;
            reaction.users.push(userId);
        } else {
            reaction.count--;
            reaction.users.splice(userIndex, 1);
            if (reaction.count === 0) {
                delete messageReactions[messageId][emoji];
            }
        }

        io.to(room).emit('reactionUpdate', {
            messageId: messageId,
            reactions: messageReactions[messageId]
        });
    });

    // Host can transfer host status
    socket.on('transferHost', (data) => {
        const { room, newHostId } = data;
        if (roomHosts[room] !== socket.id) {
            socket.emit('notification', 'You are not the current host.');
            return;
        }
        if (newHostId === socket.id) {
            socket.emit('notification', 'You are already the host.');
            return;
        }

        const newHostSocket = io.sockets.sockets.get(newHostId);
        if (newHostSocket) {
            const oldHostId = roomHosts[room];
            roomHosts[room] = newHostId;

            io.to(oldHostId).emit('role', { isHost: false });
            io.to(oldHostId).emit('notification', 'You are no longer the host.');

            io.to(newHostId).emit('role', { isHost: true });
            const newHostName = roomUsers[room].find(u => u.id === newHostId)?.name || "A user";
            io.to(newHostId).emit('notification', `You are now the host.`);
            io.to(room).emit('notification', `${newHostName} is now the host.`);
            updateUserList(room); // Update user list for everyone on host change
        } else {
            socket.emit('notification', 'Target user for host transfer not found.');
        }
    });


    socket.on('disconnect', () => {
        for (const room in roomUsers) {
            if (!roomUsers[room]) continue;
            const userIndex = roomUsers[room].findIndex(u => u.id === socket.id);
            if (userIndex !== -1) {
                const username = roomUsers[room][userIndex].name;
                const disconnectedUserId = roomUsers[room][userIndex].id;
                roomUsers[room].splice(userIndex, 1);
                updateUserList(room);

                // Clean up reactions from disconnected user
                for (const msgId in messageReactions) {
                    for (const emoji in messageReactions[msgId]) {
                        const reaction = messageReactions[msgId][emoji];
                        const userReactionIndex = reaction.users.indexOf(disconnectedUserId);
                        if (userReactionIndex !== -1) {
                            reaction.count--;
                            reaction.users.splice(userReactionIndex, 1);
                            if (reaction.count === 0) {
                                delete messageReactions[msgId][emoji];
                            }
                            io.to(room).emit('reactionUpdate', {
                                messageId: msgId,
                                reactions: messageReactions[msgId]
                            });
                        }
                    }
                }
                
                // Host transfer if current host disconnects
                if (roomHosts[room] === socket.id) {
                    if (roomUsers[room].length > 0) {
                        roomHosts[room] = roomUsers[room][0].id;
                        io.to(roomHosts[room]).emit('role', { isHost: true });
                        const newHostName = roomUsers[room][0].name;
                        io.to(roomHosts[room]).emit('notification', "You are now the Host (previous host disconnected).");
                        io.to(room).emit('notification', `${newHostName} is now the host (previous host disconnected).`);
                        updateUserList(room); // Update user list for everyone on host change
                    } else {
                        delete roomHosts[room];
                        delete roomMessages[room];
                        for (const msgId in messageReactions) {
                            const msgBelongsToEmptyRoom = Object.values(roomMessages).every(msgs => !msgs.some(m => m.id === msgId));
                            if (msgBelongsToEmptyRoom) {
                                delete messageReactions[msgId];
                            }
                        }
                    }
                }
                io.to(room).emit('notification', username + " has left the room.");
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
