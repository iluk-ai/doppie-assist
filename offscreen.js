const MAX_RECORDING_MS = 90 * 1000;
const VIDEO_BITS_PER_SECOND = 800_000;
let activeRecording = null;
let completedRecording = null;

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Video encoding failed"));
    reader.readAsDataURL(blob);
  });

const supportedMimeType = () =>
  ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
    (type) => MediaRecorder.isTypeSupported(type),
  ) || "";

async function startRecording(streamId, sessionId) {
  if (activeRecording) throw new Error("A flow video is already recording");
  completedRecording = null;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  });
  const mimeType = supportedMimeType();
  let recorder;
  try {
    recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  const chunks = [];
  const startedAt = Date.now();
  const completion = new Promise((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    recorder.addEventListener("error", (event) => {
      reject(event.error || new Error("Video recording failed"));
      if (recorder.state !== "inactive") recorder.stop();
    });
    recorder.addEventListener("stop", async () => {
      try {
        const outputMimeType = (recorder.mimeType || "video/webm").split(";")[0];
        const blob = new Blob(chunks, { type: outputMimeType });
        const result = {
          sessionId,
          dataUrl: await blobToDataUrl(blob),
          mimeType: blob.type || "video/webm",
          size: blob.size,
          durationMs: Date.now() - startedAt,
          recordedAt: new Date().toISOString(),
        };
        completedRecording = result;
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        stream.getTracks().forEach((track) => track.stop());
        activeRecording = null;
      }
    });
  });
  const timeout = setTimeout(() => {
    if (recorder.state !== "inactive") recorder.stop();
  }, MAX_RECORDING_MS);
  completion.then(
    () => clearTimeout(timeout),
    () => clearTimeout(timeout),
  );
  activeRecording = { sessionId, recorder, completion, startedAt };
  try {
    recorder.start(1000);
  } catch (error) {
    clearTimeout(timeout);
    activeRecording = null;
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  return { recording: true, startedAt, maxDurationMs: MAX_RECORDING_MS };
}

async function stopRecording(sessionId) {
  if (!activeRecording) {
    if (completedRecording?.sessionId === sessionId) return completedRecording;
    throw new Error("No flow video is recording");
  }
  if (activeRecording.sessionId !== sessionId)
    throw new Error("The active flow video belongs to another review");
  const { recorder, completion } = activeRecording;
  if (recorder.state !== "inactive") recorder.stop();
  return completion;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;
  if (message.type === "start-flow-video") {
    startRecording(message.streamId, message.sessionId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "stop-flow-video") {
    stopRecording(message.sessionId)
      .then((video) => sendResponse({ ok: true, video }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "flow-video-status") {
    sendResponse({
      ok: true,
      recording: Boolean(activeRecording),
      sessionId: activeRecording?.sessionId || completedRecording?.sessionId || null,
      video:
        completedRecording?.sessionId === message.sessionId
          ? completedRecording
          : null,
    });
    return false;
  }
  return false;
});
