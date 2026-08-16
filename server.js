const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const url = require('url');
const ytdl = require('@distube/ytdl-core');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Simple room state memory
const roomState = {};

// Video Proxy Route
app.get('/proxy', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('URL is required');

    try {
        // If it's a YouTube link, use ytdl to stream it
        if (ytdl.validateURL(videoUrl)) {
            console.log('Proxying YouTube URL:', videoUrl);
            
            // Set headers for video stream
            res.setHeader('Content-Type', 'video/mp4');
            
            // Pipe the highest quality combined audio+video stream
            ytdl(videoUrl, { filter: 'audioandvideo', quality: 'highest' })
                .on('error', (err) => {
                    console.error('YTDL Error:', err);
                    if (!res.headersSent) res.status(500).send('Failed to stream YouTube video');
                })
                .pipe(res);
            return;
        }

        // Otherwise, it's a standard direct MP4 link, just proxy it via HTTP/HTTPS
        console.log('Proxying direct URL:', videoUrl);
        const parsedUrl = new url.URL(videoUrl);
        const requestModule = parsedUrl.protocol === 'https:' ? https : http;

        const proxyReq = requestModule.request(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                ...req.headers,
                host: parsedUrl.host
            }
        }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
            console.error('Proxy error:', err);
            res.status(500).send('Failed to proxy video');
        });

        proxyReq.end();
    } catch (err) {
        console.error(err);
        res.status(400).send('Invalid URL');
    }
});

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinRoom', (room) => {
        socket.join(room);
        console.log(`${socket.id} joined room ${room}`);
        
        if (roomState[room]) {
            socket.emit('syncState', roomState[room]);
        }
    });

    // Video Sync Events
    socket.on('play', ({ room, time }) => {
        roomState[room] = { playing: true, time, lastUpdate: Date.now() };
        socket.to(room).emit('play', time);
    });
    socket.on('pause', ({ room, time }) => {
        roomState[room] = { playing: false, time, lastUpdate: Date.now() };
        socket.to(room).emit('pause', time);
    });
    socket.on('seek', ({ room, time }) => {
        if (roomState[room]) {
            roomState[room].time = time;
            roomState[room].lastUpdate = Date.now();
        }
        socket.to(room).emit('seek', time);
    });

    // Chat Events
    socket.on('chatMessage', ({ room, message, user }) => {
        io.to(room).emit('chatMessage', { message, user });
    });

    // WebRTC Signaling Events
    socket.on('webrtc-offer', ({ room, offer }) => {
        socket.to(room).emit('webrtc-offer', offer);
    });
    socket.on('webrtc-answer', ({ room, answer }) => {
        socket.to(room).emit('webrtc-answer', answer);
    });
    socket.on('webrtc-ice-candidate', ({ room, candidate }) => {
        socket.to(room).emit('webrtc-ice-candidate', candidate);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
