const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { spawn } = require("node:child_process");

const listener = path.join(
  __dirname,
  "..",
  "skills",
  "doppie-assist",
  "scripts",
  "wait-for-annotations.cjs",
);

const waitForLine = (stream, pattern) =>
  new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk) => {
      output += chunk;
      if (!pattern.test(output)) return;
      cleanup();
      resolve(output);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error(`Listener ended before matching ${pattern}: ${output}`));
    };
    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
    };
    stream.on("data", onData);
    stream.on("end", onEnd);
  });

test("listener materializes one browser handoff and exits", async (t) => {
  const port = 48000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [listener, "--port", String(port), "--timeout", "10000"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  await waitForLine(child.stdout, /waiting for browser annotations/);

  const response = await fetch(`http://127.0.0.1:${port}/annotations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Doppie-Assist": "browser-extension",
    },
    body: JSON.stringify({
      schema: "doppie-assist/handoff-v1",
      sessionId: `test-${Date.now()}`,
      page: { title: "Settings", url: "http://localhost:3000/settings" },
      annotations: [
        {
          id: "annotation-1",
          title: "Tighten spacing",
          request: "Reduce the gap.",
          selector: "#settings",
          screenshot: "data:image/png;base64,aGVsbG8=",
        },
      ],
      reproductionSteps: [],
      diagnostics: [],
      networkRequests: [
        {
          type: "fetch",
          method: "GET",
          status: 200,
          durationMs: 32,
          url: "https://example.test/api/settings",
        },
      ],
      sessionEvents: [{ type: "click", message: 'Click button "Save"' }],
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);

  const output = JSON.parse(await fs.readFile(result.bundlePath, "utf8"));
  assert.equal(output.schema, "doppie-assist/handoff-v1");
  assert.equal(output.annotations[0].screenshot, undefined);
  assert.ok(output.annotations[0].screenshotPath.endsWith("annotation-01.png"));
  assert.equal(output.networkRequests[0].status, 200);
  assert.equal(output.sessionEvents[0].type, "click");
  assert.equal(await fs.readFile(output.annotations[0].screenshotPath, "utf8"), "hello");
  const brief = await fs.readFile(result.briefPath, "utf8");
  assert.match(brief, /Tighten spacing/);
  assert.match(brief, /Network activity/);
  assert.match(brief, /Click button "Save"/);
  await fs.rm(result.directory, { recursive: true, force: true });
});
