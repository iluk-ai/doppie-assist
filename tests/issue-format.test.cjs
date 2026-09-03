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
    screenshotMode: "element",
    captureWidth: 640,
    captureHeight: 320,
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
  });

  assert.match(description, /doppie-assist\/v3/);
  assert.match(description, /URL path:\*\* `\/settings\?tab=team`/);
  assert.match(description, /Developer context/);
  assert.match(description, /role `region`/);
  assert.match(description, /"capture": \{/);
  assert.match(description, /"mode": "element"/);
  assert.match(description, /Network activity/);
  assert.match(description, /POST · 422 · 84.2ms/);
  assert.match(description, /Session events/);
  assert.match(description, /Save settings/);
  assert.doesNotMatch(description, /data:image/);
});
