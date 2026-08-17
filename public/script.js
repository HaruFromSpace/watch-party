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
let peerConnection;
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

// --- WebRTC Screen Share Logic ---
shareScreenBtn.addEventListener('click', async () => {
    if (shareScreenBtn.classList.contains('sharing')) {
        stopScreenShare();
        return;
    }

    try {
        // Optimized for trans-pacific latency (720p 30fps is much more stable than 1080p 60fps)
        const displayMediaOptions = {
            video: {
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 30, max: 60 }
            },
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        };
        
        localStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        
        // Optimize video track for motion (prioritizes framerate over resolution if bandwidth drops)
        const videoTrack = localStream.getVideoTracks()[0];
        if ('contentHint' in videoTrack) {
            videoTrack.contentHint = 'motion';
        }
        
        video.srcObject = localStream;
        video.play();
        shareScreenBtn.classList.add('sharing');
        shareScreenBtn.querySelector('.btn-content').textContent = 'Stop Sharing';

        peerConnection = new RTCPeerConnection(config);
        
        localStream.getTracks().forEach(track => {
            const sender = peerConnection.addTrack(track, localStream);
            if (track.kind === 'video') {
                const parameters = sender.getParameters();
                if (!parameters.encodings) {
                    parameters.encodings = [{}];
                }
                // Cap bitrate at 2.5 Mbps to prevent congestion across the pacific
                parameters.encodings[0].maxBitrate = 2500000; 
                parameters.encodings[0].networkPriority = 'high';
                
                sender.setParameters(parameters).catch(e => console.error("Bitrate set error:", e));
            }
        });

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc-ice-candidate', { room: currentRoom, candidate: event.candidate });
            }
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('webrtc-offer', { room: currentRoom, offer });

        localStream.getVideoTracks()[0].onended = () => stopScreenShare();
        
    } catch (err) {
        console.error("Error accessing display media.", err);
    }
});

function stopScreenShare() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection) {
        peerConnection.close();
    }
    video.srcObject = null;
    shareScreenBtn.classList.remove('sharing');
    shareScreenBtn.querySelector('.btn-content').textContent = 'Share Screen';
    appendMessage('System', 'Screen sharing stopped.');
}

// Auto-renegotiate if a user drops and reconnects (or joins late)
socket.on('userJoined', async () => {
    if (shareScreenBtn.classList.contains('sharing') && peerConnection && localStream) {
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('webrtc-offer', { room: currentRoom, offer });
        } catch (e) {
            console.error("Renegotiation failed", e);
        }
    }
});

// Incoming WebRTC Offer (Viewer side)
socket.on('webrtc-offer', async (offer) => {
    appendMessage('System', 'Incoming screen share. Establishing connection...');
    peerConnection = new RTCPeerConnection(config);
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc-ice-candidate', { room: currentRoom, candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        video.srcObject = event.streams[0];
        video.play();
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc-answer', { room: currentRoom, answer });
});

socket.on('webrtc-answer', async (answer) => {
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('webrtc-ice-candidate', async (candidate) => {
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Error adding received ice candidate', e);
        }
    }
});
