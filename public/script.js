const socket = io();

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

let currentRoom = '';
let username = '';
let isSyncing = false; // Flag to prevent echo loops

// WebRTC State
let peerConnection;
let localStream;
const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
};

// --- Room & Connection Logic ---
function connectToRoom() {
    const room = roomInput.value.trim();
    const name = usernameInput.value.trim();
    
    if (!room || !name) {
        alert("Please enter both a room name and your name.");
        return;
    }

    currentRoom = room;
    username = name;
    
    roomNameDisplay.textContent = currentRoom;
    joinModal.classList.add('hidden');
    
    socket.emit('joinRoom', currentRoom);
    appendMessage('System', `Joined room: ${currentRoom}`);
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
        
        // Let the other person know they need to load this proxy URL
        socket.emit('chatMessage', { room: currentRoom, message: `Changed video source.`, user: 'System' });
        // NOTE: For full sync, we'd broadcast the URL. For simplicity in this demo, the other user pastes the same link or we just chat it.
        // Let's actually just log it for now. We can add a full URL sync event later.
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
    div.innerHTML = `<div class="sender">${sender}</div><div>${text}</div>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- WebRTC Screen Share Logic ---
shareScreenBtn.addEventListener('click', async () => {
    try {
        // Request higher quality settings
        const displayMediaOptions = {
            video: {
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 60, max: 60 }
            },
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        };
        
        localStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        
        // Show local stream in the video player
        video.srcObject = localStream;
        video.play();
        shareScreenBtn.classList.add('sharing');
        shareScreenBtn.textContent = 'Stop Sharing';

        // Setup WebRTC Connection
        peerConnection = new RTCPeerConnection(config);
        
        // Add local tracks to peer connection and force high bitrate
        localStream.getTracks().forEach(track => {
            const sender = peerConnection.addTrack(track, localStream);
            
            // Force higher bitrate if supported
            if (track.kind === 'video') {
                const parameters = sender.getParameters();
                if (!parameters.encodings) {
                    parameters.encodings = [{}];
                }
                // Request 5Mbps max bitrate for crisp 1080p
                parameters.encodings[0].maxBitrate = 5000000; 
                sender.setParameters(parameters).catch(e => console.error("Bitrate set error:", e));
            }
        });

        // ICE Candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc-ice-candidate', { room: currentRoom, candidate: event.candidate });
            }
        };

        // Create Offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('webrtc-offer', { room: currentRoom, offer });

        // Handle stream stop
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
    shareScreenBtn.textContent = 'Share Screen';
    appendMessage('System', 'Screen sharing stopped.');
}

// Incoming WebRTC Offer (Viewer side)
socket.on('webrtc-offer', async (offer) => {
    appendMessage('System', 'Incoming screen share. Connecting...');
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
