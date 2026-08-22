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
        socket.emit('joinRoom', { room: currentRoom, username });
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
const volumeSlider = document.getElementById('volumeSlider');
const ambientGlow = document.getElementById('ambientGlow');
const glowCtx = ambientGlow.getContext('2d');

// --- Volume Logic ---
volumeSlider.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    video.volume = vol;
    if (viewerAudioEl) {
        viewerAudioEl.volume = vol;
    }
});

let currentRoom = '';
let username = '';
let isSyncing = false; // Flag to prevent echo loops

// --- Ambient Glow Logic ---
function drawGlow() {
    // Skip glow during screen share — srcObject is live capture, not video content
    if (!video.paused && !video.ended && !video.srcObject) {
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

    // Disconnect from old LiveKit room if switching rooms
    if (livekitRoom && currentRoom !== room) {
        livekitRoom.disconnect();
        livekitRoom = null;
    }

    currentRoom = room;
    username = name;
    localStorage.setItem('watchPartyUser', username);
    
    roomNameDisplay.textContent = currentRoom;
    joinModal.classList.add('hidden');
    
    // Send username so server can track participants
    socket.emit('joinRoom', { room: currentRoom, username });
    appendMessage('System', `Joined the void: ${currentRoom}`);

    setTimeout(connectLiveKit, 400);
}

function joinNewRoom() {
    joinModal.classList.remove('hidden');
}

function copyInviteLink() {
    if (!currentRoom) return;
    const url = `${location.origin}?room=${encodeURIComponent(currentRoom)}`;
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('copyInviteBtn');
        const span = btn.querySelector('.btn-content');
        span.textContent = 'Copied!';
        setTimeout(() => span.textContent = 'Copy Invite', 2000);
    }).catch(() => {
        prompt('Copy this link:', url);
    });
}

window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    const userParam = urlParams.get('user');
    
    if (roomParam) roomInput.value = roomParam;
    
    const savedUser = localStorage.getItem('watchPartyUser');
    if (userParam) {
        usernameInput.value = userParam;
    } else if (savedUser) {
        usernameInput.value = savedUser;
    }

    // Auto-login if we already have both filled out
    if (roomInput.value && usernameInput.value && !userParam) {
        connectToRoom();
    }
};

// --- Video Proxy Logic ---
async function changeVideo() {
    const url = videoUrlInput.value.trim();
    if (url) {
        const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
        
        if (shareScreenBtn.classList.contains('sharing')) {
            await stopScreenShare();
        }
        video.controls = true;
        video.srcObject = null;
        video.src = proxyUrl;
        
        // Sync the URL to all viewers so they load it too
        socket.emit('videoUrlChange', { room: currentRoom, url });
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
    // Load video URL if we don't have one yet
    if (state.videoUrl && !video.src.includes('/proxy')) {
        const proxyUrl = `/proxy?url=${encodeURIComponent(state.videoUrl)}`;
        video.controls = true;
        video.srcObject = null;
        video.src = proxyUrl;
    }
    video.currentTime = state.time || 0;
    if (state.playing) {
        video.play().catch(e => console.log('Autoplay blocked', e));
    } else {
        video.pause();
    }
    setTimeout(() => isSyncing = false, 100);
});

// Someone loaded a new video — load it on our end too
socket.on('videoUrlChange', (url) => {
    const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
    video.controls = true;
    video.srcObject = null;
    video.src = proxyUrl;
    appendMessage('System', 'Host loaded a new video.');
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

// Participant list
const participantCount = document.getElementById('participantCount');
socket.on('participantUpdate', (participants) => {
    if (participantCount) {
        participantCount.textContent = `👥 ${participants.length}`;
        participantCount.title = participants.join(', ');
    }
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

const qualitySelect = document.getElementById('qualitySelect');

// --- LiveKit Integration (Screen Share & Audio) ---
let livekitRoom = null;
let screenTrack = null;
let viewerAudioEl = null;
let LIVEKIT_URL = '';

async function getLivekitToken(room, username) {
    try {
        const response = await fetch(`/api/livekit-token?room=${encodeURIComponent(room)}&username=${encodeURIComponent(username)}`);
        const data = await response.json();
        if (data.url) LIVEKIT_URL = data.url;
        return data.token;
    } catch (err) {
        console.error('Failed to get token:', err);
        return null;
    }
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

        let audioBlocked = false;

        function showUnmutePrompt() {
            if (document.getElementById('unmute-prompt')) return;
            const prompt = document.createElement('div');
            prompt.id = 'unmute-prompt';
            prompt.style.cssText = `
                position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
                background: #e94560; color: white; padding: 10px 20px;
                border-radius: 8px; font-weight: bold; cursor: pointer; z-index: 9999;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            `;
            prompt.textContent = '🔇 Click here to unmute audio';
            prompt.onclick = () => {
                if (viewerAudioEl) viewerAudioEl.play().catch(() => {});
                prompt.remove();
            };
            document.body.appendChild(prompt);
        }

        function attachTrack(track, participant) {
            if (track.kind === 'video') {
                const old = document.getElementById('lk-viewer');
                if (old) old.remove();

                video.pause();
                video.removeAttribute('src');
                video.innerHTML = '';
                video.load();
                video.controls = false;
                video.srcObject = new MediaStream([track.mediaStreamTrack]);
                video.play().catch(() => {});
                appendMessage('System', `${participant.identity} is sharing their screen.`);
            } else if (track.kind === 'audio') {
                if (viewerAudioEl) { viewerAudioEl.pause(); viewerAudioEl.remove(); }
                viewerAudioEl = document.createElement('audio');
                viewerAudioEl.srcObject = new MediaStream([track.mediaStreamTrack]);
                viewerAudioEl.autoplay = true;
                viewerAudioEl.volume = volumeSlider.value;
                viewerAudioEl.style.display = 'none';
                document.body.appendChild(viewerAudioEl);
                viewerAudioEl.play().catch(() => {
                    // Browser blocked autoplay — show click-to-unmute prompt
                    showUnmutePrompt();
                });
            }
        }

        function detachAll() {
            const old = document.getElementById('lk-viewer');
            if (old) old.remove();
            const prompt = document.getElementById('unmute-prompt');
            if (prompt) prompt.remove();
            if (viewerAudioEl) { viewerAudioEl.pause(); viewerAudioEl.remove(); viewerAudioEl = null; }
            video.pause();
            video.srcObject = null;
        }

        livekitRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            attachTrack(track, participant);
        });

        // Force-subscribe to all published tracks (audio + video)
        livekitRoom.on(RoomEvent.TrackPublished, (publication, participant) => {
            publication.setSubscribed(true);
        });

        livekitRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
            detachAll();
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
            if (reason !== 'CLIENT_INITIATED') {
                appendMessage('System', 'LiveKit dropped. Reconnecting in 3s...');
                setTimeout(connectLiveKit, 3000);
            }
        });

        await livekitRoom.connect(LIVEKIT_URL, token);
        console.log('LiveKit connected:', livekitRoom.name);

        // Handle already-publishing participants (viewer joined late)
        livekitRoom.remoteParticipants.forEach((participant) => {
            participant.trackPublications.forEach((publication) => {
                if (publication.isSubscribed && publication.track) {
                    attachTrack(publication.track, participant);
                } else {
                    // Subscribe to both video AND audio
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

    // Loading state while browser picker opens + LiveKit connects
    const btnSpan = shareScreenBtn.querySelector('.btn-content');
    btnSpan.textContent = 'Starting...';
    shareScreenBtn.disabled = true;

    try {
        await connectLiveKit();
        if (!livekitRoom) {
            btnSpan.textContent = 'Share Screen';
            shareScreenBtn.disabled = false;
            return;
        }

        const quality = qualitySelect.value;
        const resolution = quality === '1080p60' ? { width: 1920, height: 1080, frameRate: 60 }
                         : quality === '480p30'  ? { width: 854,  height: 480,  frameRate: 30 }
                         :                         { width: 1280, height: 720,  frameRate: 30 };

        const { createLocalScreenTracks } = LivekitClient;

        const tracks = await createLocalScreenTracks({ audio: true, resolution });

        // Real quality control: bitrate cap on what LiveKit actually encodes + sends
        const videoEncoding = quality === '1080p60'
            ? { maxBitrate: 8_000_000, maxFramerate: 60 } // Uncapped for gigabit internet
            : quality === '480p30'
            ? { maxBitrate: 1_000_000, maxFramerate: 30 }
            :   { maxBitrate: 3_000_000, maxFramerate: 30 }; // 720p default

        const publishedTracks = [];
        for (const track of tracks) {
            // Force simulcast OFF so LiveKit doesn't auto-downgrade to 360p on network hiccups
            const opts = track.kind === 'video' ? { videoEncoding, simulcast: false } : {};
            await livekitRoom.localParticipant.publishTrack(track, opts);
            publishedTracks.push(track);

            if (track.kind === 'video') {
                screenTrack = track;
                // Local preview — pipe directly into video element
                video.pause();
                video.removeAttribute('src');
                video.innerHTML = '';
                video.load();
                video.srcObject = new MediaStream([track.mediaStreamTrack]);
                video.play().catch(() => {});
                track.on('ended', stopScreenShare);
            }
        }

        // Store all published tracks so stopScreenShare can unpublish all of them
        shareScreenBtn._publishedTracks = publishedTracks;

        shareScreenBtn.classList.add('sharing');
        shareScreenBtn.querySelector('.btn-content').textContent = 'Stop Sharing';
        shareScreenBtn.disabled = false;

    } catch (err) {
        console.error('Screen share error:', err);
        shareScreenBtn.querySelector('.btn-content').textContent = 'Share Screen';
        shareScreenBtn.disabled = false;
        appendMessage('System', 'Could not start screen share. Please allow screen capture.');
    }
});

async function stopScreenShare() {
    const tracks = shareScreenBtn._publishedTracks || [];
    for (const track of tracks) {
        try {
            await livekitRoom?.localParticipant.unpublishTrack(track);
            track.stop();
        } catch (e) { /* already stopped */ }
    }
    shareScreenBtn._publishedTracks = [];
    screenTrack = null;

    video.controls = false;
    video.srcObject = null;
    video.removeAttribute('src');
    video.load(); // This forces the browser to show the offline.jpg poster again
    
    shareScreenBtn.classList.remove('sharing');
    shareScreenBtn.querySelector('.btn-content').textContent = 'Share Screen';
}








