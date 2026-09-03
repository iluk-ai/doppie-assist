const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "page-monitor.js"),
  "utf8",
);

test("captures successful fetch metadata without payloads or query values", async () => {
  const emitted = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  let clock = 10;

  class MockElement {
    closest() {
      return null;
    }
  }

  class MockXhr {
    addEventListener() {}
    open() {}
    send() {}
  }

  class MockPerformanceObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
  }

  class MockCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const location = {
    href: "https://example.test/dashboard?workspace=secret#private",
  };
  const window = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    dispatchEvent(event) {
      emitted.push(event);
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      redirected: false,
      url: "https://example.test/api/issues?token=private#sensitive",
      headers: {
        get(name) {
          return name === "content-type" ? "application/json" : "128";
        },
      },
    }),
  };
  const document = {
    visibilityState: "visible",
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
  };
  const history = {
    pushState() {},
    replaceState() {},
  };

  const context = {
    URL,
    CustomEvent: MockCustomEvent,
    Element: MockElement,
    PerformanceObserver: MockPerformanceObserver,
    XMLHttpRequest: MockXhr,
    console: { error() {}, warn() {} },
    document,
    history,
    location,
    performance: { now: () => (clock += 15) },
    window,
  };
  vm.runInNewContext(source, context);

  await window.fetch("https://example.test/api/issues?token=private", {
    method: "POST",
    headers: { Authorization: "Bearer private" },
    body: '{"password":"private"}',
  });

  const event = emitted
    .map((item) => JSON.parse(item.detail))
    .find((item) => item.category === "network" && item.type === "fetch");
  assert.equal(event.method, "POST");
  assert.equal(event.status, 200);
  assert.equal(event.ok, true);
  assert.equal(event.contentType, "application/json");
  assert.equal(event.size, 128);
  assert.match(event.url, /token=%5Bredacted%5D/);
  assert.match(event.url, /#\[redacted\]$/);
  assert.doesNotMatch(JSON.stringify(event), /private|password|authorization|bearer/i);
});
