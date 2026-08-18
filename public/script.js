const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    timeout: 20000
});

// Auto-rejoin room if socket drops and reconnects
socket.on('connect', () => {
    if (currentRoom) {
        socket.emit('joinRoom', currentRoom);
    }
});

// DOM Elements
const video = document.getElementById('syncVideo');
const videoUrlInput = document.getElementById('videoUrlInput');
const roomNameDisplay = document.getElementById('roomNameDisplay');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const joinModal = document.getElementById('joinModal');
const roomInput = document.getElementById('roomInput');
const usernameInput = document.getElementById('usernameInput');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const ambientGlow = document.getElementById('ambientGlow');
const glowCtx = ambientGlow.getContext('2d');

let currentRoom = '';
let username = '';
let isSyncing = false; // Flag to prevent echo loops

// WebRTC State
const peers = {};
let localStream;
const config = {
    iceServers: [
        // Standard UDP STUN Servers
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        
        // TURN Servers (Relays traffic when direct P2P is blocked)
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        
        // Bulletproof TURN Servers (Forced TCP / TLS) - Bypasses deep packet inspection
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
};

// --- Ambient Glow Logic ---
function drawGlow() {
    if (!video.paused && !video.ended) {
        // Draw the current video frame onto the canvas
        // The canvas is blurred via CSS, creating the ambient glow effect
        ambientGlow.width = video.videoWidth || 640;
        ambientGlow.height = video.videoHeight || 360;
        glowCtx.drawImage(video, 0, 0, ambientGlow.width, ambientGlow.height);
    }
    requestAnimationFrame(drawGlow);
}
// Start the animation loop
drawGlow();

// --- Room & Connection Logic ---
function connectToRoom() {
    const room = roomInput.value.trim();
    const name = usernameInput.value.trim();
    
    if (!room || !name) {
        alert("Please enter both a room ID and your alias.");
        return;
    }

    currentRoom = room;
    username = name;
    
    roomNameDisplay.textContent = currentRoom;
    joinModal.classList.add('hidden');
    
    socket.emit('joinRoom', currentRoom);
    appendMessage('System', `Joined the void: ${currentRoom}`);
}

function joinNewRoom() {
    joinModal.classList.remove('hidden');
}

window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        roomInput.value = roomParam;
    }
};

// --- Video Proxy Logic ---
function changeVideo() {
    const url = videoUrlInput.value.trim();
    if (url) {
        // Route through our backend proxy
        const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
        
        // Clear any WebRTC stream
        if (shareScreenBtn.classList.contains('sharing')) {
            stopScreenShare();
        }
        video.srcObject = null;
        video.src = proxyUrl;
        
        socket.emit('chatMessage', { room: currentRoom, message: `Loaded new video source.`, user: 'System' });
    }
}

// --- Sync Logic (HTML5 Video) ---
video.addEventListener('play', () => {
    if (isSyncing) return;
    socket.emit('play', { room: currentRoom, time: video.currentTime });
});
video.addEventListener('pause', () => {
    if (isSyncing) return;
    socket.emit('pause', { room: currentRoom, time: video.currentTime });
});
video.addEventListener('seeked', () => {
    if (isSyncing) return;
    socket.emit('seek', { room: currentRoom, time: video.currentTime });
});

socket.on('syncState', (state) => {
    isSyncing = true;
    video.currentTime = state.time;
    if (state.playing) {
        video.play().catch(e => console.log('Autoplay blocked', e));
    } else {
        video.pause();
    }
    setTimeout(() => isSyncing = false, 100);
});

socket.on('play', (time) => {
    isSyncing = true;
    if (Math.abs(video.currentTime - time) > 1.0) {
        video.currentTime = time;
    }
    video.play().catch(e => console.log('Autoplay blocked', e));
    setTimeout(() => isSyncing = false, 100);
});
socket.on('pause', (time) => {
    isSyncing = true;
    video.currentTime = time;
    video.pause();
    setTimeout(() => isSyncing = false, 100);
});
socket.on('seek', (time) => {
    isSyncing = true;
    video.currentTime = time;
    setTimeout(() => isSyncing = false, 100);
});

// --- Chat Logic ---
const toggleStickersBtn = document.getElementById('toggleStickersBtn');
const stickerPanel = document.getElementById('stickerPanel');
const stickerGrid = document.getElementById('stickerGrid');
const gifSearchInput = document.getElementById('gifSearchInput');

// Fallback curated list of reaction gifs if the proxy fails
const DEFAULT_STICKERS = [
    "https://media.tenor.com/2sMePZ0PoyYAAAAC/anime-cheer.gif",
    "https://media.tenor.com/n1xJ8l8V-zMAAAAC/anime-cry.gif",
    "https://media.tenor.com/f_GBAqgU-H8AAAAC/anime-wow.gif",
    "https://media.tenor.com/9v1W31V3T28AAAAC/anime-laugh.gif",
    "https://media.tenor.com/n14A3J5bQxAAAAAC/anime-angry.gif",
    "https://media.tenor.com/1GvK_9M3E9EAAAAC/anime-sleep.gif",
    "https://media.tenor.com/gO2p5-q-oGEAAAAC/anime-eat.gif",
    "https://media.tenor.com/_q1EhlqZfB0AAAAC/anime-yes.gif",
    "https://media.tenor.com/bK1RvaXh7hQAAAAC/anime-nod.gif",
    "https://media.tenor.com/F4CjW5o7_nAAAAAC/anime-shock.gif"
];

function renderStickers(urls) {
    stickerGrid.innerHTML = '';
    urls.forEach(url => {
        const img = document.createElement('img');
        img.src = url;
        img.addEventListener('click', () => {
            if (currentRoom) {
                socket.emit('chatMessage', { room: currentRoom, message: url, user: username });
                stickerPanel.classList.add('hidden');
            }
        });
        stickerGrid.appendChild(img);
    });
}

async function fetchGifs(query = '') {
    try {
        const res = await fetch(`/api/gifs?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        
        if (data.urls && data.urls.length > 0) {
            renderStickers(data.urls);
        } else {
            renderStickers(DEFAULT_STICKERS);
        }
    } catch (err) {
        console.error("Failed to fetch GIFs from proxy", err);
        renderStickers(DEFAULT_STICKERS);
    }
}

// Initial load via proxy
fetchGifs();

let searchTimeout;
gifSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        fetchGifs(e.target.value.trim());
    }, 500);
});

toggleStickersBtn.addEventListener('click', () => {
    stickerPanel.classList.toggle('hidden');
    if (!stickerPanel.classList.contains('hidden') && stickerGrid.children.length <= 10) {
        fetchGifs(gifSearchInput.value.trim());
    }
});

function sendMessage() {
    const message = chatInput.value.trim();
    if (message && currentRoom) {
        socket.emit('chatMessage', { room: currentRoom, message, user: username });
        chatInput.value = '';
    }
}
sendChatBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});
socket.on('chatMessage', (data) => {
    appendMessage(data.user, data.message);
});
function appendMessage(sender, text) {
    const div = document.createElement('div');
    div.className = 'chat-message';
    
    // Check if the text is a direct link to an image or gif
    const isImage = text.match(/\.(jpeg|jpg|gif|png|webp)$/i) != null && text.startsWith('http');
    
    let contentHtml = '';
    if (isImage) {
        contentHtml = `<img src="${text}" style="max-width: 100%; border-radius: 8px; margin-top: 8px; display: block;">`;
    } else {
        // Escape HTML to prevent XSS, but allow normal text
        const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        contentHtml = `<div>${safeText}</div>`;
    }

    div.innerHTML = `<div class="sender">${sender}</div>${contentHtml}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- LiveKit Screen Share ---
// Real SFU infrastructure. Works everywhere. Audio + video. No bullshit.
const qualitySelect = document.getElementById('qualitySelect');

const LIVEKIT_URL = 'wss://web-9weyycwi.livekit.cloud';

let livekitRoom = null;
let screenTrack = null;

async function getLivekitToken(room, name) {
    const res = await fetch(`/api/livekit-token?room=${encodeURIComponent(room)}&username=${encodeURIComponent(name)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.token;
}

async function connectLiveKit() {
    if (livekitRoom) return;
    if (!currentRoom || !username) return;

    try {
        const token = await getLivekitToken(currentRoom, username);
        const { Room, RoomEvent } = LivekitClient;

        livekitRoom = new Room({
            adaptiveStream: true,
            dynacast: true,
            autoSubscribe: true,
            reconnectPolicy: {
                maxRetries: 10,
                retryDelayInMs: 2000,
                nextRetryDelayInMs: (context) => Math.min(context.retryCount * 2000, 10000),
            },
        });

        function attachTrack(track, participant) {
            if (track.kind !== 'video') return;
            const old = document.getElementById('lk-viewer');
            if (old) old.remove();

            const el = track.attach();
            el.id = 'lk-viewer';
            el.autoplay = true;
            el.playsInline = true;
            el.style.cssText = `
                position: absolute; top: 0; left: 0;
                width: 100%; height: 100%;
                border-radius: 12px;
                background: #000;
                z-index: 5;
                object-fit: contain;
            `;
            video.parentElement.style.position = 'relative';
            video.parentElement.appendChild(el);
            el.play().catch(() => {});
            appendMessage('System', `${participant.identity} is sharing their screen.`);
        }

        livekitRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            attachTrack(track, participant);
        });

        // Fallback: if track is published after we join
        livekitRoom.on(RoomEvent.TrackPublished, (publication, participant) => {
            publication.setSubscribed(true);
        });

        livekitRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
            track.detach();
            const el = document.getElementById('lk-viewer');
            if (el) el.remove();
            appendMessage('System', 'Screen share ended.');
        });

        livekitRoom.on(RoomEvent.Reconnecting, () => {
            appendMessage('System', 'LiveKit reconnecting...');
        });

        livekitRoom.on(RoomEvent.Reconnected, () => {
            appendMessage('System', 'LiveKit reconnected.');
        });

        livekitRoom.on(RoomEvent.Disconnected, (reason) => {
            console.warn('LiveKit disconnected:', reason);
            livekitRoom = null;
            // Only reconnect on unexpected drops, not user-initiated leaves
            if (reason !== 'CLIENT_INITIATED') {
                appendMessage('System', 'LiveKit dropped. Reconnecting in 3s...');
                setTimeout(connectLiveKit, 3000);
            }
        });

        await livekitRoom.connect(LIVEKIT_URL, token);
        console.log('LiveKit connected:', livekitRoom.name);

        // Check for already-publishing participants (joined late case)
        livekitRoom.remoteParticipants.forEach((participant) => {
            participant.trackPublications.forEach((publication) => {
                if (publication.isSubscribed && publication.track) {
                    attachTrack(publication.track, participant);
                } else if (publication.kind === 'video') {
                    publication.setSubscribed(true);
                }
            });
        });

    } catch (err) {
        console.error('LiveKit connect error:', err);
        appendMessage('System', `LiveKit error: ${err.message}`);
    }
}

shareScreenBtn.addEventListener('click', async () => {
    if (shareScreenBtn.classList.contains('sharing')) {
        await stopScreenShare();
        return;
    }

    try {
        await connectLiveKit();
        if (!livekitRoom) return;

        const quality = qualitySelect.value;
        const resolution = quality === '1080p60' ? { width: 1920, height: 1080, frameRate: 30 }
                         : quality === '480p30'  ? { width: 854,  height: 480,  frameRate: 24 }
                         :                         { width: 1280, height: 720,  frameRate: 30 };

        const { LocalVideoTrack, createLocalScreenTracks } = LivekitClient;

        const tracks = await createLocalScreenTracks({
            audio: true,
            resolution,
        });

        for (const track of tracks) {
            await livekitRoom.localParticipant.publishTrack(track);
            if (track.kind === 'video') {
                screenTrack = track;

                // Local preview
                video.pause();
                video.removeAttribute('src');
                video.innerHTML = '';
                video.load();
                const el = track.attach(video);

                track.on('ended', stopScreenShare);
            }
        }

        shareScreenBtn.classList.add('sharing');
        shareScreenBtn.querySelector('.btn-content').textContent = 'Stop Sharing';

    } catch (err) {
        console.error('Screen share error:', err);
        appendMessage('System', 'Could not start screen share. Please allow screen capture.');
    }
});

async function stopScreenShare() {
    if (screenTrack) {
        await livekitRoom?.localParticipant.unpublishTrack(screenTrack);
        screenTrack.stop();
        screenTrack = null;
    }
    video.srcObject = null;
    shareScreenBtn.classList.remove('sharing');
    shareScreenBtn.querySelector('.btn-content').textContent = 'Share Screen';
}

// Connect to LiveKit after joining a room
const _origConnectToRoom = connectToRoom;
window.connectToRoom = async function() {
    _origConnectToRoom();
    // slight delay to let currentRoom/username be set
    setTimeout(connectLiveKit, 500);
};








