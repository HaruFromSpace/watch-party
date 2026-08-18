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

// --- Server-Relay Screen Share (MediaRecorder Chunked Streaming) ---
// Smooth video + audio, works through ALL firewalls. No WebRTC needed.
const qualitySelect = document.getElementById('qualitySelect');

let mediaRecorder = null;

// Pick best supported mime type
function getSupportedMimeType() {
    const types = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264,opus',
        'video/webm',
    ];
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
}

shareScreenBtn.addEventListener('click', async () => {
    if (shareScreenBtn.classList.contains('sharing')) {
        stopScreenShare();
        return;
    }

    try {
        const quality = qualitySelect.value;
        
        // Capture screen + system audio (audio: true lets browser prompt for it)
        const displayConstraints = {
            video: quality === '1080p60' ? { width: 1920, height: 1080, frameRate: 30 }
                 : quality === '480p30'  ? { width: 854,  height: 480,  frameRate: 24 }
                 :                         { width: 1280, height: 720,  frameRate: 30 },
            audio: true // prompts user to share tab/system audio
        };

        localStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);

        // Local preview
        video.pause();
        video.removeAttribute('src');
        video.innerHTML = '';
        video.load();
        video.srcObject = localStream;
        video.play().catch(() => {});

        shareScreenBtn.classList.add('sharing');
        shareScreenBtn.querySelector('.btn-content').textContent = 'Stop Sharing';

        const mimeType = getSupportedMimeType();
        const bitsPerSecond = quality === '1080p60' ? 4000000 : quality === '480p30' ? 800000 : 2000000;

        mediaRecorder = new MediaRecorder(localStream, {
            mimeType: mimeType || undefined,
            videoBitsPerSecond: bitsPerSecond
        });

        // Announce mime type so viewers can init their MediaSource correctly
        socket.emit('share-started', { room: currentRoom, mimeType: mediaRecorder.mimeType });

        // Send chunks every 150ms — smooth playback, low latency
        mediaRecorder.ondataavailable = async (e) => {
            if (e.data && e.data.size > 0) {
                const buf = await e.data.arrayBuffer();
                socket.emit('screen-chunk', { room: currentRoom, chunk: buf });
            }
        };

        mediaRecorder.start(150); // 150ms chunks

        localStream.getVideoTracks()[0].onended = () => stopScreenShare();

    } catch (err) {
        console.error("Display media error:", err);
        appendMessage('System', 'Could not share screen. Allow screen capture and try again.');
    }
});

function stopScreenShare() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    video.srcObject = null;
    shareScreenBtn.classList.remove('sharing');
    shareScreenBtn.querySelector('.btn-content').textContent = 'Share Screen';
    socket.emit('share-stopped', currentRoom);
    appendMessage('System', 'Screen sharing stopped.');
}

// --- Viewer: MediaSource Extensions playback ---
let mediaSource = null;
let sourceBuffer = null;
let chunkQueue = [];
let viewerVideo = null;

function setupViewer(mimeType) {
    // Remove any old viewer
    if (viewerVideo) { viewerVideo.remove(); viewerVideo = null; }

    mediaSource = new MediaSource();
    sourceBuffer = null;
    chunkQueue = [];

    viewerVideo = document.createElement('video');
    viewerVideo.autoplay = true;
    viewerVideo.playsInline = true;
    viewerVideo.muted = false;
    viewerVideo.style.cssText = `
        position: absolute; top: 0; left: 0;
        width: 100%; height: 100%;
        border-radius: 12px;
        background: #000;
        z-index: 5;
        object-fit: contain;
    `;
    video.parentElement.style.position = 'relative';
    video.parentElement.appendChild(viewerVideo);

    viewerVideo.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => {
        try {
            sourceBuffer = mediaSource.addSourceBuffer(mimeType);
            sourceBuffer.mode = 'sequence';
            sourceBuffer.addEventListener('updateend', flushQueue);
            flushQueue();
        } catch (e) {
            console.error("SourceBuffer setup failed:", e);
        }
    });
}

function flushQueue() {
    if (!sourceBuffer || sourceBuffer.updating || chunkQueue.length === 0) return;
    try {
        sourceBuffer.appendBuffer(chunkQueue.shift());
    } catch (e) {
        console.error("appendBuffer error:", e);
        chunkQueue = []; // clear queue on error
    }
}

socket.on('share-started', ({ mimeType }) => {
    appendMessage('System', 'Screen share started. Connecting...');
    if (!MediaSource.isTypeSupported(mimeType)) {
        appendMessage('System', `Your browser doesn't support ${mimeType}. Try Chrome.`);
        return;
    }
    setupViewer(mimeType);
});

socket.on('screen-chunk', (chunk) => {
    if (!sourceBuffer) return;
    chunkQueue.push(chunk);
    flushQueue();
});

socket.on('share-stopped', () => {
    if (viewerVideo) { viewerVideo.remove(); viewerVideo = null; }
    mediaSource = null;
    sourceBuffer = null;
    chunkQueue = [];
    appendMessage('System', 'Screen share ended.');
});






