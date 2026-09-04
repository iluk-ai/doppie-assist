const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const context = { URL };
context.globalThis = context;
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "issue-format.js"), "utf8"),
  context,
);

test("agent issue format includes developer and route context", () => {
  const description = context.DoppieIssueFormat.buildIssueDescription({
    issueTitle: "Tighten settings spacing",
    request: "Reduce the vertical gap between controls.",
    pageTitle: "Settings",
    url: "https://example.test/settings?tab=team",
    feedbackType: "ui",
    mode: "element",
    label: "section.settings",
    selector: "[data-testid=settings]",
    tagName: "section",
    elementText: "Team settings",
    elementHtml: '<section data-testid="settings">Team settings</section>',
    targetState: "detached-snapshot",
    screenshotMode: "element",
    captureWidth: 640,
    captureHeight: 320,
    region: { x: 112, y: 84, width: 640, height: 320 },
    viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
    developerContext: {
      accessibility: { role: "region", name: "Team settings", focusable: false },
      boxModel: {
        content: { width: 600, height: 280 },
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        margin: { top: 0, right: 0, bottom: 24, left: 0 },
      },
      styles: { key: { display: "grid", gap: "24px" } },
    },
    networkRequests: [
      {
        type: "fetch",
        method: "POST",
        status: 422,
        ok: false,
        durationMs: 84.2,
        contentType: "application/json",
        url: "https://example.test/api/settings?team=%5Bredacted%5D",
      },
    ],
    sessionEvents: [
      {
        type: "click",
        message: 'Click button "Save settings"',
        url: "https://example.test/settings",
      },
    ],
    sessionVideo: {
      dataUrl: "data:video/webm;base64,dmlkZW8=",
      mimeType: "video/webm",
      size: 4096,
      durationMs: 6200,
      recordedAt: "2026-09-03T12:00:00.000Z",
    },
  });

  assert.match(description, /doppie-assist\/v3/);
  assert.match(description, /URL path:\*\* `\/settings\?tab=team`/);
  assert.match(description, /Developer context/);
  assert.match(description, /role `region`/);
  assert.match(description, /"capture": \{/);
  assert.match(description, /"mode": "element"/);
  assert.match(description, /Selected region:\*\* x 112, y 84, 640 x 320px/);
  assert.match(description, /Viewport:\*\* 1440 x 900px @ 2x/);
  assert.match(
    description,
    /Element left the DOM; saved selection evidence used/,
  );
  assert.match(description, /"state": "detached-snapshot"/);
  assert.match(description, /"region": \{/);
  assert.match(description, /Network activity/);
  assert.match(description, /POST · 422 · 84.2ms/);
  assert.match(description, /Session events/);
  assert.match(description, /Save settings/);
  assert.match(description, /Flow video/);
  assert.match(description, /6s, 4 KB, no audio/);
  assert.doesNotMatch(description, /data:image/);
  assert.doesNotMatch(description, /data:video/);
});
