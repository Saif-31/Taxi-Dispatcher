// Production-ready WebRTC implementation for OpenAI Realtime API
// Includes reconnection, error handling, audio visualization, and session management

// DOM Elements
const startBtn = document.getElementById('start-btn');
const endBtn = document.getElementById('end-btn');
const statusElement = document.getElementById('status');
const statusText = document.getElementById('status-text');
const transcriptDiv = document.getElementById('transcript');
const errorDiv = document.getElementById('error');
const warningDiv = document.getElementById('warning');
const audioElement = document.getElementById('audio-playback');
const audioLevelContainer = document.getElementById('audio-level-container');
const audioLevelFill = document.getElementById('audio-level');
const sessionInfo = document.getElementById('session-info');
const sessionIdSpan = document.getElementById('session-id');
const expiresAtSpan = document.getElementById('expires-at');

// Connection States
const ConnectionState = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  LISTENING: 'listening',
  THINKING: 'thinking',
  DISCONNECTED: 'disconnected',
  ERROR: 'error'
};

// State management
let peerConnection = null;
let dataChannel = null;
let audioContext = null;
let mediaStream = null;
let currentState = ConnectionState.IDLE;
let reconnectAttempts = 0;
let sessionExpiryTimeout = null;
let audioAnalyser = null;
let audioLevelInterval = null;

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 2000;

// Update status display
function updateStatus(state, message) {
  currentState = state;
  statusElement.className = `status status-${state}`;
  statusText.textContent = message;
  console.log(`Status: ${state} - ${message}`);
}

// Show error
function showError(message, persistent = false) {
  errorDiv.textContent = `❌ Error: ${message}`;
  errorDiv.style.display = 'block';
  
  if (!persistent) {
    setTimeout(() => {
      errorDiv.style.display = 'none';
    }, 5000);
  }
}

// Show warning
function showWarning(message) {
  warningDiv.textContent = `⚠️ ${message}`;
  warningDiv.style.display = 'block';
  
  setTimeout(() => {
    warningDiv.style.display = 'none';
  }, 5000);
}

// Hide error/warning
function hideMessages() {
  errorDiv.style.display = 'none';
  warningDiv.style.display = 'none';
}

// Add transcript message
function addTranscript(speaker, message, isSystem = false) {
  // Remove empty state
  const emptyState = transcriptDiv.querySelector('.transcript-empty');
  if (emptyState) {
    emptyState.remove();
  }

  const item = document.createElement('div');
  item.className = `transcript-item transcript-${isSystem ? 'system' : speaker}`;
  
  if (isSystem) {
    item.innerHTML = `${message}`;
  } else {
    item.innerHTML = `
      ${speaker === 'user' ? '👤 You' : '🤖 AI Dispatcher'}
      ${message}
    `;
  }
  
  transcriptDiv.appendChild(item);
  transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
}

// Audio level visualization
function startAudioLevelMonitoring() {
  if (!audioContext || !mediaStream) return;

  try {
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(audioAnalyser);

    const bufferLength = audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    audioLevelContainer.style.display = 'block';

    audioLevelInterval = setInterval(() => {
      audioAnalyser.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;
      const percentage = Math.min((average / 128) * 100, 100);
      
      audioLevelFill.style.width = `${percentage}%`;
    }, 100);

  } catch (error) {
    console.error('Audio level monitoring failed:', error);
  }
}

function stopAudioLevelMonitoring() {
  if (audioLevelInterval) {
    clearInterval(audioLevelInterval);
    audioLevelInterval = null;
  }
  audioLevelContainer.style.display = 'none';
  audioLevelFill.style.width = '0%';
}

// Session expiry warning
function setupSessionExpiry(expiresAt) {
  if (sessionExpiryTimeout) {
    clearTimeout(sessionExpiryTimeout);
  }

  const expiryTime = new Date(expiresAt).getTime();
  const now = Date.now();
  const timeUntilExpiry = expiryTime - now;

  // Show warning 1 minute before expiry
  const warningTime = timeUntilExpiry - 60000;

  if (warningTime > 0) {
    sessionExpiryTimeout = setTimeout(() => {
      showWarning('Session expiring in 1 minute. Please end call and start a new one.');
    }, warningTime);
  }

  // Auto-disconnect at expiry
  if (timeUntilExpiry > 0) {
    setTimeout(() => {
      addTranscript('system', 'Session expired. Call ended automatically.', true);
      endCall();
    }, timeUntilExpiry);
  }
}

// Display session info
function displaySessionInfo(sessionId, expiresAt) {
  sessionIdSpan.textContent = sessionId.substring(0, 20) + '...';
  
  const expiryDate = new Date(expiresAt);
  expiresAtSpan.textContent = expiryDate.toLocaleTimeString();
  
  sessionInfo.style.display = 'flex';
}

// Start call
async function startCall() {
  try {
    hideMessages();
    updateStatus(ConnectionState.CONNECTING, 'Connecting to server...');
    startBtn.disabled = true;

    // Step 1: Get ephemeral token from backend
    console.log('📡 Requesting session token...');
    
    // Determine the correct API endpoint based on environment
    const apiUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? `http://localhost:3000/api/session`
      : '/api/session';
    
    console.log('Using API URL:', apiUrl);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      let errorMessage;
      const contentType = response.headers.get('content-type');
      
      try {
        // Check if response is JSON
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          errorMessage = errorData.error || `Server error: ${response.status}`;
        } else {
          // Response is not JSON (likely HTML error page)
          const errorText = await response.text();
          
          if (errorText.includes('<!DOCTYPE') || errorText.includes('<html')) {
            errorMessage = 'API endpoint not available. Please make sure you are running "vercel dev" to start the local server with API support.';
            console.error('Received HTML instead of JSON. The API route may not be running.');
          } else {
            errorMessage = `Server error: ${response.status}`;
          }
        }
      } catch (parseError) {
        console.error('Error parsing response:', parseError);
        errorMessage = `Server error: ${response.status}`;
      }
      
      throw new Error(errorMessage);
    }

    // Parse JSON response
    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      console.error('Failed to parse JSON response:', jsonError);
      throw new Error('Invalid response from server. Make sure the API is running correctly.');
    }

    if (!data.client_secret) {
      throw new Error('Invalid session data received from server.');
    }

    const EPHEMERAL_KEY = data.client_secret;
    
    console.log('✅ Session token received');
    displaySessionInfo(data.session_id, data.expires_at);
    setupSessionExpiry(data.expires_at);

    // Step 2: Get user microphone
    updateStatus(ConnectionState.CONNECTING, 'Requesting microphone access...');
    
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
      console.log('✅ Microphone access granted');
    } catch (micError) {
      if (micError.name === 'NotAllowedError') {
        throw new Error('Microphone access denied. Please allow microphone and try again.');
      } else if (micError.name === 'NotFoundError') {
        throw new Error('No microphone found. Please connect a microphone and try again.');
      } else {
        throw new Error('Failed to access microphone: ' + micError.message);
      }
    }

    // Step 3: Set up audio context
    audioContext = new AudioContext({ sampleRate: 24000 });

    // Step 4: Set up WebRTC peer connection
    updateStatus(ConnectionState.CONNECTING, 'Establishing connection...');
    peerConnection = new RTCPeerConnection();

    // Handle incoming audio from AI
    peerConnection.ontrack = (event) => {
      console.log('📥 Receiving audio from AI');
      audioElement.srcObject = event.streams[0];
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);
      
      if (peerConnection.connectionState === 'failed') {
        console.error('WebRTC connection failed');
        handleReconnection();
      } else if (peerConnection.connectionState === 'disconnected') {
        console.warn('WebRTC disconnected');
      }
    };

    // Handle ICE connection state
    peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', peerConnection.iceConnectionState);
      
      if (peerConnection.iceConnectionState === 'failed') {
        console.error('ICE connection failed');
        handleReconnection();
      }
    };

    // Add microphone track to peer connection
    mediaStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, mediaStream);
    });

    // Step 5: Set up data channel for events
    dataChannel = peerConnection.createDataChannel('oai-events');
    
    dataChannel.onopen = () => {
      console.log('✅ Data channel open');
      updateStatus(ConnectionState.CONNECTED, '🎤 Connected! Start speaking...');
      endBtn.disabled = false;
      reconnectAttempts = 0;
      
      // Start audio level monitoring
      startAudioLevelMonitoring();
      
      addTranscript('system', '✅ Connected successfully. The AI is ready to help you book a ride!', true);
    };

    dataChannel.onclose = () => {
      console.log('📪 Data channel closed');
    };

    dataChannel.onerror = (error) => {
      console.error('Data channel error:', error);
    };

    dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
      } catch (e) {
        console.error('Failed to parse server message:', e);
      }
    };

    // Step 6: Create and set offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Step 7: Connect to OpenAI Realtime API
    console.log('🔗 Connecting to OpenAI Realtime API...');
    const baseUrl = 'https://api.openai.com/v1/realtime';
    const model = 'gpt-4o-realtime-preview-2024-12-17';
    
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        'Authorization': `Bearer ${EPHEMERAL_KEY}`,
        'Content-Type': 'application/sdp',
      },
    });

    if (!sdpResponse.ok) {
      const errorText = await sdpResponse.text();
      console.error('SDP exchange failed:', errorText);
      throw new Error(`Failed to connect to OpenAI: ${sdpResponse.status}`);
    }

    const answerSdp = await sdpResponse.text();
    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp,
    });

    console.log('✅ WebRTC connection established successfully');

  } catch (error) {
    console.error('❌ Call failed:', error);
    showError(error.message, true);
    updateStatus(ConnectionState.ERROR, 'Connection failed');
    endCall();
  }
}

// Handle messages from OpenAI Realtime API
function handleServerMessage(message) {
  console.log('📨 Server message:', message.type);

  switch (message.type) {
    // Session events
    case 'session.created':
      console.log('Session created:', message.session);
      break;

    case 'session.updated':
      console.log('Session updated:', message.session);
      break;

    // Input audio events (user speaking)
    case 'input_audio_buffer.speech_started':
      console.log('🎤 User started speaking');
      updateStatus(ConnectionState.LISTENING, '🎤 Listening to you...');
      break;

    case 'input_audio_buffer.speech_stopped':
      console.log('🤫 User stopped speaking');
      updateStatus(ConnectionState.THINKING, '🤔 AI is thinking...');
      break;

    case 'conversation.item.input_audio_transcription.completed':
      // User's speech transcription complete
      if (message.transcript) {
        console.log('User said:', message.transcript);
        addTranscript('user', message.transcript);
      }
      break;

    case 'conversation.item.input_audio_transcription.failed':
      console.error('Transcription failed:', message.error);
      break;

    // Response events (AI responding)
    case 'response.created':
      console.log('🤖 AI response started');
      updateStatus(ConnectionState.CONNECTED, '🤖 AI is responding...');
      break;

    case 'response.done':
      console.log('✅ AI response complete');
      updateStatus(ConnectionState.CONNECTED, '🎤 Ready for your response...');
      break;

    case 'response.audio_transcript.delta':
      // AI is speaking (partial transcript) - we can ignore these
      break;

    case 'response.audio_transcript.done':
      // AI finished speaking (full transcript)
      if (message.transcript) {
        console.log('AI said:', message.transcript);
        addTranscript('ai', message.transcript);
      }
      break;

    case 'response.audio.delta':
      // Audio chunk received - handled by WebRTC track
      break;

    case 'response.audio.done':
      console.log('🔊 Audio playback complete');
      break;

    // Function calling events
    case 'response.function_call_arguments.done':
      console.log('📞 Function call:', message.name, message.arguments);
      
      if (message.name === 'confirm_booking') {
        try {
          const args = JSON.parse(message.arguments);
          addTranscript('system', `
            ✅ Booking Confirmed!
            📍 Pickup: ${args.pickup}
            🎯 Destination: ${args.destination}
            💰 Fare: ${args.fare}
            ⏱️ ETA: ${args.eta}
          `, true);
        } catch (e) {
          console.error('Failed to parse function arguments:', e);
        }
      }
      break;

    // Error events
    case 'error':
      console.error('❌ Server error:', message.error);
      showError(message.error.message || 'An error occurred');
      
      if (message.error.code === 'session_expired') {
        addTranscript('system', 'Session expired. Please start a new call.', true);
        endCall();
      }
      break;

    // Rate limit events
    case 'rate_limits.updated':
      console.log('Rate limits:', message.rate_limits);
      break;

    default:
      console.log('Unhandled message type:', message.type);
  }
}

// Handle reconnection attempts
async function handleReconnection() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('❌ Max reconnection attempts reached');
    showError('Connection lost. Please start a new call.', true);
    endCall();
    return;
  }

  reconnectAttempts++;
  console.log(`🔄 Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
  
  updateStatus(ConnectionState.CONNECTING, `Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
  addTranscript('system', `Connection lost. Attempting to reconnect... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, true);

  // Clean up current connection
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }

  // Wait before reconnecting
  await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));

  // Try to reconnect
  try {
    await startCall();
  } catch (error) {
    console.error('Reconnection failed:', error);
    handleReconnection();
  }
}

// End call
function endCall() {
  console.log('📞 Ending call...');

  // Clear timers
  if (sessionExpiryTimeout) {
    clearTimeout(sessionExpiryTimeout);
    sessionExpiryTimeout = null;
  }

  // Stop audio monitoring
  stopAudioLevelMonitoring();

  // Close data channel
  if (dataChannel) {
    try {
      dataChannel.close();
    } catch (e) {
      console.error('Error closing data channel:', e);
    }
    dataChannel = null;
  }

  // Close peer connection
  if (peerConnection) {
    try {
      peerConnection.close();
    } catch (e) {
      console.error('Error closing peer connection:', e);
    }
    peerConnection = null;
  }

  // Stop media stream
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => {
      try {
        track.stop();
      } catch (e) {
        console.error('Error stopping track:', e);
      }
    });
    mediaStream = null;
  }

  // Close audio context
  if (audioContext) {
    try {
      audioContext.close();
    } catch (e) {
      console.error('Error closing audio context:', e);
    }
    audioContext = null;
  }

  // Clear audio element
  audioElement.srcObject = null;

  // Hide session info
  sessionInfo.style.display = 'none';

  // Reset UI
  if (currentState !== ConnectionState.ERROR) {
    updateStatus(ConnectionState.DISCONNECTED, 'Call ended');
    addTranscript('system', '📞 Call ended. Click "Start Call" to begin a new conversation.', true);
  }
  
  startBtn.disabled = false;
  endBtn.disabled = true;
  reconnectAttempts = 0;

  console.log('✅ Cleanup complete');
}

// Event listeners
startBtn.addEventListener('click', startCall);
endBtn.addEventListener('click', endCall);

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (currentState === ConnectionState.CONNECTED || 
      currentState === ConnectionState.LISTENING || 
      currentState === ConnectionState.THINKING) {
    endCall();
  }
});

// Handle visibility change (tab switching)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('Tab hidden');
  } else {
    console.log('Tab visible');
    // Check if connection is still alive
    if (peerConnection && peerConnection.connectionState === 'failed') {
      showWarning('Connection may have been lost while tab was hidden.');
    }
  }
});

// Check browser compatibility
window.addEventListener('load', () => {
  // Check for required APIs
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError('Your browser does not support microphone access. Please use a modern browser like Chrome, Firefox, or Safari.', true);
    startBtn.disabled = true;
  }

  if (!window.RTCPeerConnection) {
    showError('Your browser does not support WebRTC. Please use a modern browser.', true);
    startBtn.disabled = true;
  }

  if (!window.AudioContext && !window.webkitAudioContext) {
    console.warn('AudioContext not supported, audio visualization will be disabled');
  }

  console.log('✅ Browser compatibility check complete');
  console.log('Ready to start voice call');
});