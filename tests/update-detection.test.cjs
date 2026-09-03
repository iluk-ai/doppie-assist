const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const backgroundSource = fs.readFileSync(
  path.join(__dirname, "..", "background.js"),
  "utf8",
);

const makeHarness = () => {
  const state = {};
  const badgeTexts = [];
  const badgeTitles = [];
  const createdTabs = [];
  const downloadRequests = [];
  const shownDownloads = [];
  let messageListener;
  let alarmListener;
  let downloadListener;
  let installedListener;
  let fetchCount = 0;

  const chrome = {
    action: {
      setBadgeText: async ({ text }) => badgeTexts.push(text),
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
      setTitle: async ({ title }) => badgeTitles.push(title),
    },
    alarms: {
      create: async () => {},
      onAlarm: { addListener: (listener) => (alarmListener = listener) },
    },
    commands: { onCommand: { addListener() {} } },
    identity: { getRedirectURL: () => "https://example.chromiumapp.org/linear" },
    runtime: {
      getManifest: () => ({ version: "0.26.0" }),
      getURL: (value) => `chrome-extension://test/${value}`,
      getContexts: async () => [],
      onInstalled: {
        addListener(listener) {
          installedListener = listener;
        },
      },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
    scripting: {},
    storage: {
      local: {
        get(key, callback) {
          const keys = Array.isArray(key) ? key : [key];
          const result = Object.fromEntries(keys.map((item) => [item, state[item]]));
          if (callback) callback(result);
          return Promise.resolve(result);
        },
        set(values) {
          Object.assign(state, values);
          return Promise.resolve();
        },
      },
      session: {},
    },
    offscreen: { createDocument: async () => {} },
    tabCapture: { getMediaStreamId: async () => "stream-id" },
    downloads: {
      download: async (input) => {
        downloadRequests.push(input);
        return 42;
      },
      search: async () => [{ id: 42, state: "in_progress" }],
      show: async (downloadId) => shownDownloads.push(downloadId),
      onChanged: {
        addListener(listener) {
          downloadListener = listener;
        },
      },
    },
    tabs: {
      create: async (input) => {
        createdTabs.push(input);
        return input;
      },
    },
  };

  const fetch = async () => {
    fetchCount += 1;
    return {
      ok: true,
      json: async () => ({
        tag_name: "v9.9.9",
        html_url: "https://github.com/iluk-ai/doppie-assist/releases/tag/v9.9.9",
        assets: [
          {
            name: "doppie-assist-browser-extension-v9.9.9.zip",
            browser_download_url:
              "https://github.com/iluk-ai/doppie-assist/releases/download/v9.9.9/doppie-assist-browser-extension-v9.9.9.zip",
          },
        ],
      }),
    };
  };

  vm.runInNewContext(backgroundSource, {
    chrome,
    fetch,
    URL,
    URLSearchParams,
    AbortController,
    Blob,
    Headers,
    TextEncoder,
    Uint8Array,
    crypto: globalThis.crypto,
    atob,
    btoa,
    clearTimeout,
    setTimeout,
  });

  const sendMessage = (message) =>
    new Promise((resolve) => messageListener(message, {}, resolve));

  return {
    badgeTexts,
    badgeTitles,
    createdTabs,
    downloadRequests,
    shownDownloads,
    get alarmListener() {
      return alarmListener;
    },
    get fetchCount() {
      return fetchCount;
    },
    get installedListener() {
      return installedListener;
    },
    triggerDownloadChanged(delta) {
      return downloadListener(delta);
    },
    sendMessage,
    state,
  };
};

test("detects and caches a newer GitHub release", async () => {
  const harness = makeHarness();
  const first = await harness.sendMessage({
    type: "check-for-updates",
    force: true,
  });

  assert.equal(first.ok, true);
  assert.equal(first.available, true);
  assert.equal(first.release.version, "9.9.9");
  assert.equal(harness.fetchCount, 1);
  assert.equal(harness.badgeTexts.at(-1), "UP");
  assert.match(harness.badgeTitles.at(-1), /v9\.9\.9 available/);
  assert.equal(harness.state.latestReleaseCheck.assetName, first.release.assetName);

  const cached = await harness.sendMessage({ type: "check-for-updates" });
  assert.equal(cached.ok, true);
  assert.equal(harness.fetchCount, 1);
});

test("registers the periodic update alarm listener", () => {
  const harness = makeHarness();
  assert.equal(typeof harness.alarmListener, "function");
});

test("initializes extension storage without a developer mode preference", async () => {
  const harness = makeHarness();
  harness.installedListener();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.state.developerMode, undefined);
  assert.equal(harness.state.captures.length, 0);
  assert.equal(harness.state.issues.length, 0);
});

test("opens Chrome shortcut settings from the extension UI", async () => {
  const harness = makeHarness();
  const response = await harness.sendMessage({ type: "open-shortcut-settings" });

  assert.equal(response.ok, true);
  assert.equal(harness.createdTabs.length, 1);
  assert.equal(harness.createdTabs[0].url, "chrome://extensions/shortcuts");
});

test("tracks a GitHub update download and opens its installation surfaces", async () => {
  const harness = makeHarness();
  const response = await harness.sendMessage({
    type: "download-extension-update",
    release: {
      tagName: "v9.9.9",
      version: "9.9.9",
      assetName: "doppie-assist-browser-extension-v9.9.9.zip",
      downloadUrl:
        "https://github.com/iluk-ai/doppie-assist/releases/download/v9.9.9/doppie-assist-browser-extension-v9.9.9.zip",
    },
  });

  assert.equal(response.ok, true);
  assert.equal(response.download.status, "downloading");
  assert.equal(harness.downloadRequests[0].saveAs, true);
  await harness.triggerDownloadChanged({
    id: 42,
    state: { current: "complete" },
  });
  assert.equal(harness.state.extensionUpdateDownload.status, "ready");

  const opened = await harness.sendMessage({
    type: "open-extension-update",
    downloadId: 42,
  });
  assert.equal(opened.ok, true);
  assert.deepEqual(harness.shownDownloads, [42]);
  assert.equal(harness.createdTabs[0].url, "chrome://extensions");
});
