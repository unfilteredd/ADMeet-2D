// script.js (Client-side JavaScript)
const socket = io();
let myId = null;
const players = {};   // Track positions of all players (including self)
const peers = {};     // Active peer connections: { [peerId]: { pc } }

const arena = document.getElementById('arena');
const remoteVideos = document.getElementById('remoteVideos');
const localVideo = document.getElementById('localVideo');
let localStream = null;

// Get local media (camera + mic)
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  .then(stream => {
    localStream = stream;
    localVideo.srcObject = stream;
  })
  .catch(err => console.error('Media error:', err));

socket.on('connect', () => {
  myId = socket.id;
});

// Initialize existing players (positions) when joining
socket.on('initPlayers', (serverPlayers) => {
  for (const id in serverPlayers) {
    if (id === socket.id) continue;
    const { x, y } = serverPlayers[id];
    players[id] = { x, y };
    addAvatar(id, x, y);
  }
});

socket.on('initSelf', pos => {
    players[socket.id] = { x: pos.x, y: pos.y };
    myX = pos.x;
    myY = pos.y;
    addAvatar(socket.id, pos.x, pos.y);
  });
  

// When another player joins
socket.on('newPlayer', (player) => {
  players[player.id] = { x: player.x, y: player.y };
  addAvatar(player.id, player.x, player.y);
});

// When another player moves
socket.on('playerMoved', (player) => {
  const { id, x, y } = player;
  players[id] = { x, y };
  moveAvatar(id, x, y);
  checkProximity();
});

// When a player leaves
socket.on('playerLeft', (id) => {
  removeAvatar(id);
  delete players[id];
  endCall(id);  // close any call with this peer
});

// Handle incoming WebRTC offers
socket.on('offer', async (data) => {
  const fromId = data.from;
  const pc = new RTCPeerConnection({ iceServers: [{urls: 'stun:stun.l.google.com:19302'}] });
  peers[fromId] = { pc };
  // Add local stream to peer connection
  if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  // ICE candidates for peer
  pc.onicecandidate = evt => {
    if (evt.candidate) {
      socket.emit('ice-candidate', { to: fromId, candidate: evt.candidate });
    }
  };
  // Remote stream handling
  pc.ontrack = evt => {
    let vid = document.getElementById(`video-${fromId}`);
    if (!vid) {
      vid = document.createElement('video');
      vid.id = `video-${fromId}`;
      vid.autoplay = true;
      remoteVideos.appendChild(vid);
    }
    vid.srcObject = evt.streams[0];
  };
  // Set remote description and create answer
  await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { to: fromId, sdp: pc.localDescription });
});

// Handle incoming WebRTC answers
socket.on('answer', async (data) => {
  const fromId = data.from;
  const pc = peers[fromId]?.pc;
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  }
});

// Handle incoming ICE candidates
socket.on('ice-candidate', async (data) => {
  const fromId = data.from;
  const pc = peers[fromId]?.pc;
  if (pc && data.candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

// DOM: add avatar element
function addAvatar(id, x, y) {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'avatar' + (id === myId ? ' myAvatar' : '');
  el.textContent = id.substring(0, 3); // show first 3 chars of ID
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  arena.appendChild(el);
}

// Move an existing avatar element
function moveAvatar(id, x, y) {
  const el = document.getElementById(id);
  if (el) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }
}

// Remove avatar element and video when user leaves
function removeAvatar(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
  const vid = document.getElementById(`video-${id}`);
  if (vid) vid.remove();
}

// End a call with a peer
function endCall(id) {
  const peer = peers[id];
  if (peer) {
    peer.pc.close();
    delete peers[id];
    const vid = document.getElementById(`video-${id}`);
    if (vid) vid.remove();
  }
}

// Proximity check and call initiation
function checkProximity() {
  const threshold = 150;  // distance threshold in pixels
  if (!localStream) return;
  const me = players[myId];
  for (const id in players) {
    if (id === myId) continue;
    const other = players[id];
    const dx = me.x - other.x;
    const dy = me.y - other.y;
    const dist = Math.hypot(dx, dy);
    // Within threshold and not already in a call
    if (dist < threshold) {
      if (!peers[id] && myId < id) {
        startCall(id);
      }
    } else {
      // Too far: end call if it exists
      if (peers[id]) {
        endCall(id);
      }
    }
  }
}

// Initiate a WebRTC call to peer 'id'
function startCall(id) {
  const pc = new RTCPeerConnection({ iceServers: [{urls: 'stun:stun.l.google.com:19302'}] });
  peers[id] = { pc };
  // Add local stream tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  // ICE candidate handling
  pc.onicecandidate = evt => {
    if (evt.candidate) {
      socket.emit('ice-candidate', { to: id, candidate: evt.candidate });
    }
  };
  // Remote stream handling
  pc.ontrack = evt => {
    let vid = document.getElementById(`video-${id}`);
    if (!vid) {
      vid = document.createElement('video');
      vid.id = `video-${id}`;
      vid.autoplay = true;
      remoteVideos.appendChild(vid);
    }
    vid.srcObject = evt.streams[0];
  };
  // Create and send offer
  pc.createOffer()
    .then(offer => pc.setLocalDescription(offer))
    .then(() => {
      socket.emit('offer', { to: id, sdp: pc.localDescription });
    })
    .catch(err => console.error('Offer error:', err));
}

// Handle keyboard movement (WASD)
let myX = 0, myY = 0;  // these will be set on 'initSelf'
const speed = 5;
document.addEventListener('keydown', (e) => {
  if (!players[myId]) return;
  if (e.key === 'w' || e.key === 'W') { myY -= speed; }
  if (e.key === 'a' || e.key === 'A') { myX -= speed; }
  if (e.key === 's' || e.key === 'S') { myY += speed; }
  if (e.key === 'd' || e.key === 'D') { myX += speed; }
  // Clamp within arena bounds (optional)
  myX = Math.max(0, Math.min(myX, 800 - 40));
  myY = Math.max(0, Math.min(myY, 600 - 40));
  // Update own avatar position
  players[myId] = { x: myX, y: myY };
  moveAvatar(myId, myX, myY);
  socket.emit('move', { x: myX, y: myY });
  checkProximity();
});
