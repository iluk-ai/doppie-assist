const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "offscreen.js"),
  "utf8",
);

test("records tab video and releases its media stream", async () => {
  let listener;
  let trackStopped = false;
  const stream = {
    getTracks: () => [{ stop: () => (trackStopped = true) }],
  };

  class FakeFileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload();
      });
    }
  }

  class FakeMediaRecorder {
    static isTypeSupported(type) {
      return type.includes("vp8");
    }

    constructor(_stream, options) {
      this.mimeType = options.mimeType;
      this.state = "inactive";
      this.listeners = new Map();
    }

    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    }

    start() {
      this.state = "recording";
      this.listeners.get("dataavailable")({
        data: new Blob(["video"], { type: this.mimeType }),
      });
    }

    stop() {
      this.state = "inactive";
      queueMicrotask(() => this.listeners.get("stop")());
    }
  }

  vm.runInNewContext(source, {
    Blob,
    Buffer,
    Date,
    FileReader: FakeFileReader,
    MediaRecorder: FakeMediaRecorder,
    chrome: {
      runtime: {
        onMessage: { addListener: (callback) => (listener = callback) },
      },
    },
    navigator: {
      mediaDevices: { getUserMedia: async () => stream },
    },
    clearTimeout,
    queueMicrotask,
    setTimeout,
  });

  const send = (message) =>
    new Promise((resolve) => {
      assert.equal(typeof listener(message, {}, resolve), "boolean");
    });

  const started = await send({
    target: "offscreen",
    type: "start-flow-video",
    streamId: "tab-stream",
    sessionId: "review-1",
  });
  assert.equal(started.ok, true);
  assert.equal(started.recording, true);

  const activeStatus = await send({
    target: "offscreen",
    type: "flow-video-status",
    sessionId: "review-1",
  });
  assert.equal(activeStatus.recording, true);
  assert.equal(activeStatus.sessionId, "review-1");

  const stopped = await send({
    target: "offscreen",
    type: "stop-flow-video",
    sessionId: "review-1",
  });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.video.mimeType, "video/webm");
  assert.match(stopped.video.dataUrl, /^data:video\/webm;base64,/);
  assert.equal(trackStopped, true);

  const completedStatus = await send({
    target: "offscreen",
    type: "flow-video-status",
    sessionId: "review-1",
  });
  assert.equal(completedStatus.recording, false);
  assert.equal(completedStatus.video.sessionId, "review-1");
});
