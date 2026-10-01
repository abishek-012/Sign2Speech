/**
 * Sign2Speech — Frontend Application Logic
 *
 * Backend API (FastAPI, default port 8000):
 *   POST /predict
 *   Body: multipart/form-data
 *     - file     : video file (Blob / File)
 *     - language : "english" | "tamil" | "hindi"
 *
 *   Response JSON:
 *     { class_id: number, label: string, confidence: number, language: string }
 *     or on error:
 *     { error: string, supported_languages?: string[] }
 */

// ── CONFIGURATION ──────────────────────────────────────────────────────────
const BACKEND_URL = 'http://localhost:8000';
const PREDICT_ENDPOINT = `${BACKEND_URL}/predict`;
const HEALTH_ENDPOINT  = `${BACKEND_URL}/health`;

// ── STATE ──────────────────────────────────────────────────────────────────
let mediaStream    = null;   // Active camera stream
let mediaRecorder  = null;   // MediaRecorder instance
let recordedChunks = [];     // Video data chunks from recording
let videoBlob      = null;   // Final recorded/uploaded video blob
let videoSource    = null;   // 'recorded' | 'uploaded'
let isRecording    = false;

// ── DOM REFERENCES ──────────────────────────────────────────────────────────
const videoPreview      = document.getElementById('videoPreview');
const videoPlaceholder  = document.getElementById('videoPlaceholder');
const videoContainer    = document.getElementById('videoContainer');
const recordingBadge    = document.getElementById('recordingBadge');
const recordBtn         = document.getElementById('recordBtn');
const stopBtn           = document.getElementById('stopBtn');
const predictBtn        = document.getElementById('predictBtn');
const languageSelect    = document.getElementById('languageSelect');
const fileInput         = document.getElementById('fileInput');
const fileNameDisplay   = document.getElementById('fileNameDisplay');
const errorBox          = document.getElementById('errorBox');
const errorMessage      = document.getElementById('errorMessage');
const loadingCard       = document.getElementById('loadingCard');
const resultCard        = document.getElementById('resultCard');
const emptyResult       = document.getElementById('emptyResult');

// Result fields
const resultLabel      = document.getElementById('resultLabel');
const resultConfidence = document.getElementById('resultConfidence');
const resultLanguage   = document.getElementById('resultLanguage');
const resultClassId    = document.getElementById('resultClassId');
const confBarFill      = document.getElementById('confBarFill');
const confBarPct       = document.getElementById('confBarPct');
const confBarTrack     = document.getElementById('confBarTrack');

// Backend status
const backendStatusDot   = document.getElementById('backendStatus');
const backendStatusLabel = document.getElementById('backendStatusLabel');


// ── BACKEND HEALTH CHECK ────────────────────────────────────────────────────
async function checkBackendHealth() {
  try {
    const res = await fetch(HEALTH_ENDPOINT, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      setBackendStatus('online', 'Backend Online');
    } else {
      setBackendStatus('offline', 'Backend Error');
    }
  } catch {
    setBackendStatus('offline', 'Backend Offline');
  }
}

function setBackendStatus(state, label) {
  backendStatusDot.className = 'badge-dot ' + state;
  backendStatusLabel.textContent = label;
}

// Check health on load and every 30 seconds
checkBackendHealth();
setInterval(checkBackendHealth, 30000);


// ── HELPERS ─────────────────────────────────────────────────────────────────

function showError(msg) {
  errorMessage.textContent = msg;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorMessage.textContent = '';
}

function showPlaceholder(show) {
  videoPlaceholder.style.display = show ? 'flex' : 'none';
}

function setVideoSrc(src) {
  videoPreview.src = src;
  videoPreview.muted = !src;          // unmute for uploaded / recorded playback
  showPlaceholder(!src);
  videoContainer.classList.toggle('active', !!src);
}

function enablePredictBtn(enabled) {
  predictBtn.disabled = !enabled;
}

function capitalise(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}


// ── CAMERA / RECORDING ──────────────────────────────────────────────────────

async function startRecording() {
  clearError();

  // Guard: already recording
  if (isRecording) return;

  try {
    // Request camera permission
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      showError('Camera permission denied. Please allow camera access in your browser settings and try again.');
    } else if (err.name === 'NotFoundError') {
      showError('No camera found. Please connect a webcam and try again.');
    } else {
      showError(`Could not access camera: ${err.message}`);
    }
    return;
  }

  // Reset previous video
  videoBlob = null;
  videoSource = null;
  recordedChunks = [];
  fileNameDisplay.textContent = '';
  fileInput.value = '';

  // Show live camera feed (muted, autoplay)
  videoPreview.srcObject = mediaStream;
  videoPreview.muted = true;
  videoPreview.src = '';
  await videoPreview.play().catch(() => {});
  showPlaceholder(false);
  videoContainer.classList.add('active');

  // Pick a supported MIME type
  const mimeType = getSupportedMimeType();

  try {
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : {});
  } catch (err) {
    showError(`Could not start recording: ${err.message}`);
    stopStream();
    return;
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = handleRecordingStop;

  mediaRecorder.onerror = (event) => {
    showError(`Recording error: ${event.error?.message || 'Unknown error'}`);
    stopStream();
    setRecordingUI(false);
  };

  mediaRecorder.start(200); // collect data every 200ms
  isRecording = true;
  setRecordingUI(true);
}

function getSupportedMimeType() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;

  mediaRecorder.stop();  // triggers onstop → handleRecordingStop
  stopStream();
  isRecording = false;
  setRecordingUI(false);
}

function stopStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (videoPreview.srcObject) {
    videoPreview.srcObject = null;
  }
}

function handleRecordingStop() {
  if (recordedChunks.length === 0) {
    showError('Recording produced no data. Try again.');
    showPlaceholder(true);
    videoContainer.classList.remove('active');
    return;
  }

  const mimeType = mediaRecorder?.mimeType || 'video/webm';
  videoBlob = new Blob(recordedChunks, { type: mimeType });
  videoSource = 'recorded';

  // Show the recorded video in the preview (playable)
  const blobUrl = URL.createObjectURL(videoBlob);
  videoPreview.srcObject = null;
  videoPreview.src = blobUrl;
  videoPreview.muted = false;
  videoPreview.controls = true;
  videoPreview.load();

  showPlaceholder(false);
  videoContainer.classList.add('active');
  fileNameDisplay.textContent = `✔ Recorded video ready (${formatBytes(videoBlob.size)})`;
  enablePredictBtn(true);
  clearError();
}

function setRecordingUI(recording) {
  recordBtn.disabled  = recording;
  stopBtn.disabled    = !recording;
  recordingBadge.hidden = !recording;
  if (!recording) enablePredictBtn(!!videoBlob);
}


// ── FILE UPLOAD ─────────────────────────────────────────────────────────────

function handleFileUpload(event) {
  clearError();
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('video/')) {
    showError('Please select a valid video file (MP4, WebM, MOV, AVI, etc.).');
    return;
  }

  // Stop any active recording
  if (isRecording) stopRecording();

  videoBlob = file;
  videoSource = 'uploaded';

  const blobUrl = URL.createObjectURL(file);
  videoPreview.srcObject = null;
  videoPreview.src = blobUrl;
  videoPreview.muted = false;
  videoPreview.controls = true;
  videoPreview.load();

  showPlaceholder(false);
  videoContainer.classList.add('active');
  fileNameDisplay.textContent = `✔ ${file.name} (${formatBytes(file.size)})`;
  enablePredictBtn(true);
}


// ── PREDICTION ──────────────────────────────────────────────────────────────

async function predictSign() {
  clearError();

  if (!videoBlob) {
    showError('No video available. Record from your camera or upload a video file first.');
    return;
  }

  const language = languageSelect.value;  // 'english' | 'tamil' | 'hindi'

  // Build form data exactly as backend expects
  const formData = new FormData();

  // Determine filename/extension for the blob
  let filename = 'sign_video';
  if (videoBlob instanceof File) {
    filename = videoBlob.name;
  } else {
    const ext = mimeToExt(videoBlob.type);
    filename = `recorded${ext}`;
  }

  formData.append('file', videoBlob, filename);
  formData.append('language', language);

  // Show loading state
  setLoadingState(true);

  try {
    const res = await fetch(PREDICT_ENDPOINT, {
      method: 'POST',
      body: formData,
      // Do NOT set Content-Type header — browser sets it with boundary automatically
    });

    if (!res.ok) {
      // HTTP-level error
      const text = await res.text();
      throw new Error(`Server returned ${res.status}: ${text || res.statusText}`);
    }

    const data = await res.json();

    if (data.error) {
      showError(`Backend error: ${data.error}${data.supported_languages ? ` (Supported: ${data.supported_languages.join(', ')})` : ''}`);
      setLoadingState(false);
      return;
    }

    // Validate expected fields
    if (data.label === undefined || data.confidence === undefined) {
      throw new Error('Unexpected response format from backend.');
    }

    displayResult(data);

  } catch (err) {
    setLoadingState(false);

    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      showError(`Cannot reach the backend. Make sure the backend server is running at ${BACKEND_URL}.`);
      setBackendStatus('offline', 'Backend Offline');
    } else if (err.name === 'AbortError') {
      showError('Request timed out. The backend may be processing a large video — try again with a shorter clip.');
    } else {
      showError(err.message || 'An unexpected error occurred. Please try again.');
    }
  }
}

function displayResult(data) {
  setLoadingState(false);

  // Populate result fields
  resultLabel.textContent      = data.label || '—';
  resultClassId.textContent    = data.class_id !== undefined ? `#${data.class_id}` : '—';
  resultLanguage.textContent   = capitalise(data.language) || '—';

  const pct = Math.round((data.confidence || 0) * 100 * 100) / 100;  // 2 decimal places
  resultConfidence.textContent = `${pct.toFixed(2)}%`;
  confBarPct.textContent       = `${pct.toFixed(2)}%`;

  // Animate confidence bar
  requestAnimationFrame(() => {
    confBarFill.style.width = `${Math.min(pct, 100)}%`;
    confBarTrack.setAttribute('aria-valuenow', Math.round(pct));
  });

  // Show result card, hide others
  emptyResult.hidden  = true;
  loadingCard.hidden  = true;
  resultCard.hidden   = false;
}

function clearResult() {
  resultCard.hidden  = true;
  emptyResult.hidden = false;
  confBarFill.style.width = '0%';
}

function setLoadingState(loading) {
  loadingCard.hidden  = !loading;
  emptyResult.hidden  = loading || !resultCard.hidden;

  predictBtn.disabled = loading;
  recordBtn.disabled  = loading;
  stopBtn.disabled    = true;

  if (!loading) {
    // Re-enable record if not currently recording
    recordBtn.disabled = isRecording;
    stopBtn.disabled   = !isRecording;
    enablePredictBtn(!!videoBlob);
  }
}


// ── UTILITIES ────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeToExt(mimeType) {
  const map = {
    'video/webm':  '.webm',
    'video/mp4':   '.mp4',
    'video/ogg':   '.ogg',
    'video/x-matroska': '.mkv',
  };
  // Strip codecs suffix
  const base = mimeType.split(';')[0].trim();
  return map[base] || '.webm';
}


// ── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Only when no input focused
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;

  if (e.key === 'r' || e.key === 'R') {
    if (!recordBtn.disabled) startRecording();
  } else if (e.key === 's' || e.key === 'S') {
    if (!stopBtn.disabled) stopRecording();
  } else if (e.key === 'Enter') {
    if (!predictBtn.disabled) predictSign();
  }
});


// ── INIT ─────────────────────────────────────────────────────────────────────
// Show placeholder initially
showPlaceholder(true);
enablePredictBtn(false);
setRecordingUI(false);
