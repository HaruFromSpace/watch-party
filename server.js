const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const url = require('url');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Simple room state memory
const roomState = {};

// Helper to fetch JSON
const fetchJson = (urlStr) => {
    return new Promise((resolve, reject) => {
        https.get(urlStr, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
};

const INVIDIOUS_INSTANCES = [
    'https://invidious.jing.rocks',
    'https://vid.puffyan.us',
    'https://inv.tux.pizza',
    'https://invidious.nerdvpn.de',
    'https://invidious.namazso.eu'
];

// Video Proxy Route
app.get('/proxy', async (req, res) => {
    let videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('URL is required');

    try {
        // Detect YouTube URL
        const ytMatch = videoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
        
        if (ytMatch && ytMatch[1]) {
            const videoId = ytMatch[1];
            console.log('Detected YouTube Video ID:', videoId);
            
            let metadata = null;
            // Try multiple instances until one works
            for (const instance of INVIDIOUS_INSTANCES) {
                const apiUrl = `${instance}/api/v1/videos/${videoId}`;
                console.log(`Trying Invidious API: ${apiUrl}`);
                try {
                    metadata = await fetchJson(apiUrl);
                    if (metadata && metadata.formatStreams && metadata.formatStreams.length > 0) {
                        break; // Success
                    }
                } catch (e) {
                    console.log(`Instance ${instance} failed. Trying next...`);
                }
            }
            
            if (metadata && metadata.formatStreams && metadata.formatStreams.length > 0) {
                // Get the best format
                const bestStream = metadata.formatStreams.sort((a, b) => b.bitrate - a.bitrate)[0];
                videoUrl = bestStream.url;
                console.log('Successfully extracted raw MP4 URL');
            } else {
                throw new Error('All Invidious instances failed or blocked.');
            }
        } else {
            console.log('Proxying direct URL:', videoUrl);
        }

        // Now proxy the raw videoUrl (either the direct link or the extracted MP4 link)
        const parsedUrl = new url.URL(videoUrl);
        const requestModule = parsedUrl.protocol === 'https:' ? https : http;

        const proxyReq = requestModule.request(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                ...req.headers,
                host: parsedUrl.host
            }
        }, (proxyRes) => {
            // Forward headers
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            // Pipe the media chunk by chunk
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
            console.error('Proxy stream error:', err);
            if (!res.headersSent) res.status(500).send('Failed to proxy video');
        });

        proxyReq.end();
    } catch (err) {
        console.error('Proxy Error:', err.message);
        if (!res.headersSent) res.status(400).send('Failed to process URL');
    }
});

// --- GIF Proxy (Bypasses Great Firewall and removes API Key requirement) ---
app.get('/api/gifs', (req, res) => {
    const query = req.query.q || 'trending';
    const url = `https://tenor.com/search/${encodeURIComponent(query).replace(/%20/g, '-')}-gifs`;

    https.get(url, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
            try {
                // Extract tenor GIF URLs from the HTML
                const matches = Array.from(data.matchAll(/src="(https:\/\/media\.tenor\.com\/[^"]+\.gif)"/g));
                const urls = [...new Set(matches.map(m => m[1]))].slice(0, 12);
                res.json({ urls });
            } catch (err) {
                console.error("Error parsing Tenor HTML:", err);
                res.json({ urls: [] });
            }
        });
    }).on('error', (err) => {
        console.error("Error fetching Tenor HTML:", err);
        res.json({ urls: [] });
    });
});

// --- WebRTC Signaling ---
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
