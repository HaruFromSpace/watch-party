const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const url = require('url');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

app.use(express.static(path.join(__dirname, 'public')));

// LiveKit Token Endpoint
app.get('/api/livekit-token', async (req, res) => {
    const { room, username } = req.query;
    if (!room || !username) return res.status(400).json({ error: 'room and username required' });
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        return res.status(500).json({ error: 'LiveKit API keys not configured on server.' });
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: username,
        ttl: '6h',
    });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

    const token = await at.toJwt();
    res.json({ token });
});

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

// Track participants per room: room -> { socketId: username }
const roomParticipants = {};

io.on('connection', (socket) => {
    let currentRoom = null;
    let currentUser = null;

    socket.on('joinRoom', ({ room, username }) => {
        // Support legacy string-only joinRoom calls
        if (typeof room === 'string' && typeof username === 'undefined') {
            username = 'Anonymous';
        }

        currentRoom = room;
        currentUser = username || 'Anonymous';

        socket.join(room);

        // Track participant
        if (!roomParticipants[room]) roomParticipants[room] = {};
        roomParticipants[room][socket.id] = currentUser;

        // Send current state to new joiner (includes videoUrl)
        if (roomState[room]) {
            socket.emit('syncState', roomState[room]);
        }

        // Broadcast updated participant list to whole room
        const participants = Object.values(roomParticipants[room]);
        io.to(room).emit('participantUpdate', participants);
    });

    // Video Sync Events
    socket.on('play', ({ room, time }) => {
        if (!roomState[room]) roomState[room] = {};
        Object.assign(roomState[room], { playing: true, time, lastUpdate: Date.now() });
        socket.to(room).emit('play', time);
    });
    socket.on('pause', ({ room, time }) => {
        if (!roomState[room]) roomState[room] = {};
        Object.assign(roomState[room], { playing: false, time, lastUpdate: Date.now() });
        socket.to(room).emit('pause', time);
    });
    socket.on('seek', ({ room, time }) => {
        if (roomState[room]) {
            roomState[room].time = time;
            roomState[room].lastUpdate = Date.now();
        }
        socket.to(room).emit('seek', time);
    });

    // Video URL sync — when host loads a new video, everyone gets it
    socket.on('videoUrlChange', ({ room, url }) => {
        if (!roomState[room]) roomState[room] = {};
        roomState[room].videoUrl = url;
        roomState[room].time = 0;
        roomState[room].playing = false;
        socket.to(room).emit('videoUrlChange', url);
    });

    // Chat Events
    socket.on('chatMessage', ({ room, message, user }) => {
        io.to(room).emit('chatMessage', { message, user });
    });

    socket.on('disconnect', () => {
        if (currentRoom && roomParticipants[currentRoom]) {
            delete roomParticipants[currentRoom][socket.id];
            const participants = Object.values(roomParticipants[currentRoom]);
            io.to(currentRoom).emit('participantUpdate', participants);
            if (participants.length === 0) {
                delete roomParticipants[currentRoom];
                delete roomState[currentRoom];
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
