// Grab the HTML elements we need so the page can read input, update the status
// label, and show local and remote video.
const roomIdInput = document.getElementById("roomId");
const joinButton = document.getElementById("joinButton");
const startCallButton = document.getElementById("startCallButton");
const endCallButton = document.getElementById("endCallButton");
const toggleMicButton = document.getElementById("toggleMicButton");
const toggleCameraButton = document.getElementById("toggleCameraButton");
const statusText = document.getElementById("statusText");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const callScreen = document.getElementById("callScreen");
const controlsOverlay = document.getElementById("controlsOverlay");

// These variables hold our current app state so different functions can share it.
let socket;
let localStream;
let peerConnection;
let joinedRoomId = "";
let hasPeerInRoom = false;
let pendingIceCandidates = [];
let controlsHideTimer;

const appConfig = window.APP_CONFIG || {};
const turnConfig = appConfig.turn || {};

// STUN helps each browser discover its public internet-facing address.
// That gives WebRTC a much better chance of connecting across home Wi-Fi,
// mobile networks, offices, and users in different countries.
//
// TURN is optional here, but the config is structured so you can add it later
// without changing the rest of the app.
const iceServers = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302"
    ]
  }
];

// TURN is usually needed when direct peer-to-peer connection fails.
// For example, some corporate networks, hotel Wi-Fi, and mobile carriers block
// the direct path, so TURN relays the media through a server in the middle.
//
// We read TURN values from window.APP_CONFIG, which is served by the Node.js
// server from environment variables. That keeps secrets out of frontend files
// in the repo, even though the browser will still receive them at runtime.
if (
  Array.isArray(turnConfig.urls) &&
  turnConfig.urls.length > 0 &&
  turnConfig.username &&
  turnConfig.credential
) {
  iceServers.push({
    urls: turnConfig.urls,
    username: turnConfig.username,
    credential: turnConfig.credential
  });

  console.log("TURN is configured for this app.");
} else {
  console.log("TURN is not configured. This app will use STUN only.");
}

const rtcConfig = { iceServers };

// This helper updates the visible status text and also prints the same message
// to the browser console so debugging is easier.
function setStatus(message) {
  statusText.textContent = message;
  statusText.dataset.state = message;
  console.log("STATUS:", message);
}

// The UI shows a placeholder message until a real stream is attached.
function setVideoActive(videoElement, isActive) {
  videoElement.dataset.active = isActive ? "true" : "false";
}

// Show the overlays for a short time, then hide them again so the video gets
// the spotlight. This is similar to how social video apps behave.
function showControlsTemporarily() {
  callScreen.classList.remove("controls-hidden");
  callScreen.classList.add("controls-visible");

  window.clearTimeout(controlsHideTimer);
  controlsHideTimer = window.setTimeout(() => {
    callScreen.classList.add("controls-hidden");
  }, 3000);
}

// Small helper so we always send JSON messages the same way.
function sendSignalMessage(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket is not connected yet.");
    return;
  }

  socket.send(JSON.stringify(payload));
}

// This asks the browser for camera and microphone permission.
// Once the user allows it, we show the stream in the local video box.
async function setupLocalMedia() {
  if (localStream) {
    return localStream;
  }

  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  localVideo.srcObject = localStream;
  setVideoActive(localVideo, true);
  setStatus("camera ready");
  updateMediaButtons();
  showControlsTemporarily();
  return localStream;
}

// The button labels change so the page clearly shows the current mic/camera
// state to a beginner using the demo.
function updateMediaButtons() {
  const audioTrack = localStream?.getAudioTracks()[0];
  const videoTrack = localStream?.getVideoTracks()[0];
  const isMicOn = Boolean(audioTrack?.enabled);
  const isCameraOn = Boolean(videoTrack?.enabled);

  toggleMicButton.textContent = isMicOn ? "🎤" : "🔇";
  toggleCameraButton.textContent = isCameraOn ? "📷" : "🚫";
  toggleMicButton.dataset.muted = isMicOn ? "false" : "true";
  toggleCameraButton.dataset.disabled = isCameraOn ? "false" : "true";
  toggleMicButton.setAttribute(
    "aria-label",
    isMicOn ? "Turn microphone off" : "Turn microphone on"
  );
  toggleCameraButton.setAttribute(
    "aria-label",
    isCameraOn ? "Turn camera off" : "Turn camera on"
  );
}

// If ICE candidates arrive before the remote description is ready, we hold
// them for a moment and apply them later.
async function flushPendingIceCandidates() {
  if (!peerConnection?.remoteDescription) {
    return;
  }

  while (pendingIceCandidates.length > 0) {
    const candidate = pendingIceCandidates.shift();
    await peerConnection.addIceCandidate(candidate);
  }
}

// This creates the main WebRTC call object and connects its important events.
function createPeerConnection() {
  if (peerConnection) {
    return peerConnection;
  }

  peerConnection = new RTCPeerConnection(rtcConfig);

  // Every time the browser discovers a possible network path, send it to the
  // other person through the signaling server.
  peerConnection.onicecandidate = (event) => {
    if (!event.candidate) {
      return;
    }

    sendSignalMessage({
      type: "ice-candidate",
      candidate: event.candidate
    });
  };

  // This is a helpful WebRTC debug event. It tells us how the ICE transport is
  // doing while the browsers are trying to connect.
  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE connection state:", peerConnection.iceConnectionState);

    if (peerConnection.iceConnectionState === "checking") {
      setStatus("connecting");
      showControlsTemporarily();
    }

    if (["connected", "completed"].includes(peerConnection.iceConnectionState)) {
      setStatus("connected");
    }

    if (peerConnection.iceConnectionState === "failed") {
      setStatus("disconnected");
    }
  };

  // This is the higher-level connection state. It is useful because it tells
  // us whether the peer connection as a whole is connecting or fully connected.
  peerConnection.onconnectionstatechange = () => {
    console.log("Peer connection state:", peerConnection.connectionState);

    if (peerConnection.connectionState === "connecting") {
      setStatus("connecting");
    }

    if (peerConnection.connectionState === "connected") {
      setStatus("connected");
    }

    if (["disconnected", "failed", "closed"].includes(peerConnection.connectionState)) {
      setStatus("disconnected");
    }
  };

  // This tells us what step of the offer/answer handshake we are currently in.
  peerConnection.onsignalingstatechange = () => {
    console.log("Signaling state:", peerConnection.signalingState);
  };

  // When the remote stream arrives, show it in the remote video element.
  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    setVideoActive(remoteVideo, true);
    setStatus("connected");
    showControlsTemporarily();
  };

  // Add every local media track into the call so the other person can receive
  // our video and audio.
  for (const track of localStream.getTracks()) {
    peerConnection.addTrack(track, localStream);
  }

  return peerConnection;
}

// Close and forget the current RTCPeerConnection only.
function closePeerConnection() {
  pendingIceCandidates = [];

  if (!peerConnection) {
    return;
  }

  peerConnection.onicecandidate = null;
  peerConnection.oniceconnectionstatechange = null;
  peerConnection.onconnectionstatechange = null;
  peerConnection.onsignalingstatechange = null;
  peerConnection.ontrack = null;
  peerConnection.close();
  peerConnection = null;
}

// Stop camera and microphone and clear the local video element.
function stopLocalMedia() {
  if (!localStream) {
    return;
  }

  for (const track of localStream.getTracks()) {
    track.stop();
  }

  localStream = null;
  localVideo.srcObject = null;
  setVideoActive(localVideo, false);
}

// End Call should leave the room, stop the media devices, clear remote video,
// close the peer connection, and leave the page ready to join again.
function cleanupCall({ notifyServer = true } = {}) {
  if (notifyServer && socket && socket.readyState === WebSocket.OPEN && joinedRoomId) {
    sendSignalMessage({ type: "leave" });
  }

  closePeerConnection();
  stopLocalMedia();

  remoteVideo.srcObject = null;
  setVideoActive(remoteVideo, false);
  hasPeerInRoom = false;
  joinedRoomId = "";
  updateMediaButtons();

  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }

    socket = null;
  }

  setStatus("disconnected");
  showControlsTemporarily();
}

// Connect to the signaling server over WebSocket.
// This server does not carry the video itself. It only helps both browsers
// exchange setup messages.
function connectWebSocket() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return Promise.resolve(socket);
  }

  return new Promise((resolve, reject) => {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${wsProtocol}//${window.location.host}`);

    socket.onopen = () => {
      console.log("WebSocket connected.");
      resolve(socket);
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      reject(new Error("Could not connect to signaling server."));
    };

    socket.onclose = () => {
      console.log("WebSocket closed.");

      if (joinedRoomId) {
        hasPeerInRoom = false;
        setStatus("disconnected");
      }
    };

    // Handle messages from the signaling server.
    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "welcome") {
        console.log("Connected to signaling server:", message.peerId);
        return;
      }

      if (message.type === "joined") {
        hasPeerInRoom = message.peers.length > 0;
        console.log("Joined room:", message.roomId, "existing peers:", message.peers);
        setStatus("joined room");

        if (hasPeerInRoom) {
          setStatus("connecting");
        } else {
          setStatus("waiting for peer");
        }
        showControlsTemporarily();
        return;
      }

      if (message.type === "peer-joined") {
        hasPeerInRoom = true;
        console.log("Another peer joined:", message.peerId);
        setStatus("waiting for peer");
        showControlsTemporarily();
        return;
      }

      if (message.type === "peer-left") {
        console.log("Peer left the room.");
        hasPeerInRoom = false;
        remoteVideo.srcObject = null;
        setVideoActive(remoteVideo, false);
        closePeerConnection();
        setStatus("waiting for peer");
        showControlsTemporarily();
        return;
      }

      if (message.type === "left") {
        console.log("Left room.");
        return;
      }

      // If the other person starts the call, we receive an offer here.
      // We attach the offer, make an answer, and send the answer back.
      if (message.type === "offer") {
        await setupLocalMedia();
        createPeerConnection();
        setStatus("connecting");

        await peerConnection.setRemoteDescription(
          new RTCSessionDescription({
            type: "offer",
            sdp: message.sdp
          })
        );

        await flushPendingIceCandidates();

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        sendSignalMessage({
          type: "answer",
          sdp: answer.sdp
        });
        return;
      }

      // If we started the call, this finishes the WebRTC handshake.
      if (message.type === "answer") {
        if (!peerConnection) {
          return;
        }

        await peerConnection.setRemoteDescription(
          new RTCSessionDescription({
            type: "answer",
            sdp: message.sdp
          })
        );

        await flushPendingIceCandidates();
        return;
      }

      // ICE candidates are extra connection hints discovered after the main
      // offer/answer exchange.
      if (message.type === "ice-candidate" && message.candidate) {
        const candidate = new RTCIceCandidate(message.candidate);

        if (peerConnection?.remoteDescription) {
          await peerConnection.addIceCandidate(candidate);
        } else {
          pendingIceCandidates.push(candidate);
        }
        return;
      }

      if (message.type === "error") {
        console.error(message.message);
        setStatus(message.message);
        showControlsTemporarily();
      }
    };
  });
}

// Join the room so both browsers can find each other through the signaling
// server. We also ask for camera and microphone here so the user knows early
// whether permissions are working.
joinButton.addEventListener("click", async () => {
  try {
    joinedRoomId = roomIdInput.value.trim() || "demo-room";
    setStatus("connecting");

    await setupLocalMedia();
    await connectWebSocket();

    sendSignalMessage({
      type: "join",
      roomId: joinedRoomId
    });
    showControlsTemporarily();
  } catch (error) {
    console.error(error);
    setStatus("Could not join room");
    showControlsTemporarily();
  }
});

// Start the 1-to-1 call by creating the WebRTC offer and sending it to the
// other person in the same room.
startCallButton.addEventListener("click", async () => {
  if (!joinedRoomId) {
    alert("Join a room first.");
    return;
  }

  if (!hasPeerInRoom) {
    alert("Wait for another person to join the same room first.");
    return;
  }

  try {
    await setupLocalMedia();
    createPeerConnection();
    setStatus("connecting");

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    sendSignalMessage({
      type: "offer",
      sdp: offer.sdp
    });
    showControlsTemporarily();
  } catch (error) {
    console.error(error);
    setStatus("Could not start call");
    showControlsTemporarily();
  }
});

// End Call cleans up everything and returns the page to a state where the user
// can press Join Room again for a fresh test.
endCallButton.addEventListener("click", () => {
  cleanupCall();
});

// Toggling the mic just enables or disables the audio track.
toggleMicButton.addEventListener("click", async () => {
  try {
    await setupLocalMedia();
    const audioTrack = localStream.getAudioTracks()[0];

    if (!audioTrack) {
      return;
    }

    audioTrack.enabled = !audioTrack.enabled;
    updateMediaButtons();
    showControlsTemporarily();
  } catch (error) {
    console.error(error);
    setStatus("Could not access microphone");
    showControlsTemporarily();
  }
});

// Toggling the camera enables or disables the video track.
toggleCameraButton.addEventListener("click", async () => {
  try {
    await setupLocalMedia();
    const videoTrack = localStream.getVideoTracks()[0];

    if (!videoTrack) {
      return;
    }

    videoTrack.enabled = !videoTrack.enabled;
    updateMediaButtons();
    showControlsTemporarily();
  } catch (error) {
    console.error(error);
    setStatus("Could not access camera");
    showControlsTemporarily();
  }
});

// Tapping anywhere on the call screen should bring the controls back.
callScreen.addEventListener("pointerdown", () => {
  showControlsTemporarily();
});

// Set the initial labels when the page first loads.
setVideoActive(localVideo, false);
setVideoActive(remoteVideo, false);
updateMediaButtons();
showControlsTemporarily();
