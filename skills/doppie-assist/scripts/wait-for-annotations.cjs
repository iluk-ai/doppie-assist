#!/usr/bin/env node

const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");

const EXTENSION_ORIGIN =
  "chrome-extension://ifchfjlgbdafpbfofmkpnackdmjoblmn";
const MAX_BODY_BYTES = 40 * 1024 * 1024;
const DEFAULT_PORT = 47361;
const DEFAULT_TIMEOUT = 30 * 60 * 1000;

const argumentValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const port = argumentValue("--port", DEFAULT_PORT);
const timeoutMs = argumentValue("--timeout", DEFAULT_TIMEOUT);
let finished = false;

const respond = (response, status, payload, origin = "") => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin === EXTENSION_ORIGIN
      ? { "Access-Control-Allow-Origin": EXTENSION_ORIGIN, Vary: "Origin" }
      : {}),
  });
  response.end(JSON.stringify(payload));
};

const safeSegment = (value, fallback) => {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return normalized || fallback;
};

const decodeImage = (dataUrl) => {
  const match = /^data:image\/(jpeg|png|webp);base64,([a-z0-9+/=\s]+)$/i.exec(
    dataUrl || "",
  );
  if (!match) return null;
  return {
    extension: match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase(),
    bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64"),
  };
};

async function writeScreenshot(directory, dataUrl, basename) {
  const image = decodeImage(dataUrl);
  if (!image) return null;
  const file = path.join(directory, `${basename}.${image.extension}`);
  await writeFile(file, image.bytes, { mode: 0o600 });
  return file;
}

async function materializeBundle(bundle) {
  if (bundle?.schema !== "doppie-assist/handoff-v1")
    throw new Error("Unsupported or missing Doppie Assist bundle schema");
  if (!Array.isArray(bundle.annotations))
    throw new Error("Annotation bundle is missing its annotations array");
  if (!bundle.annotations.length && !bundle.reproductionSteps?.length)
    throw new Error("The review does not contain annotations or a recorded flow");

  const session = safeSegment(bundle.sessionId, Date.now().toString());
  const directory = path.join(os.tmpdir(), "doppie-assist", session);
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const output = structuredClone(bundle);
  for (let index = 0; index < output.annotations.length; index += 1) {
    const annotation = output.annotations[index];
    annotation.screenshotPath = await writeScreenshot(
      directory,
      annotation.screenshot,
      `annotation-${String(index + 1).padStart(2, "0")}`,
    );
    delete annotation.screenshot;
  }
  for (let index = 0; index < (output.reproductionSteps || []).length; index += 1) {
    const step = output.reproductionSteps[index];
    step.screenshotPath = await writeScreenshot(
      directory,
      step.screenshot,
      `step-${String(index + 1).padStart(2, "0")}`,
    );
    delete step.screenshot;
  }

  const bundlePath = path.join(directory, "bundle.json");
  const briefPath = path.join(directory, "brief.md");
  const brief = [
    `# Doppie Assist review`,
    "",
    `- Page: ${output.page?.title || "Untitled page"}`,
    `- URL: ${output.page?.url || "Unknown"}`,
    `- Annotations: ${output.annotations.length}`,
    `- Recorded steps: ${(output.reproductionSteps || []).length}`,
    `- Network requests: ${(output.networkRequests || []).length}`,
    `- Session events: ${(output.sessionEvents || []).length}`,
    `- Diagnostics: ${(output.diagnostics || []).length}`,
    "",
    ...output.annotations.flatMap((annotation, index) => [
      `## ${index + 1}. ${annotation.title || "Untitled annotation"}`,
      "",
      annotation.request || "No request provided.",
      "",
      `- Selector: \`${annotation.developerContext?.selector?.primary || annotation.selector || "Unavailable"}\``,
      `- Screenshot: ${annotation.screenshotPath || "None"}`,
      "",
      annotation.issueDescription || "",
      "",
    ]),
    ...(output.networkRequests?.length
      ? [
          "## Network activity",
          "",
          ...output.networkRequests.slice(-40).map((item) => {
            const summary = [
              item.type || "request",
              item.method || "GET",
              item.status ?? (item.ok ? "ok" : "pending"),
              Number.isFinite(item.durationMs) ? `${item.durationMs}ms` : "",
            ]
              .filter(Boolean)
              .join(" | ");
            return `- [${summary}] ${item.url || "Unknown URL"}`;
          }),
          "",
        ]
      : []),
    ...(output.sessionEvents?.length
      ? [
          "## Session events",
          "",
          ...output.sessionEvents
            .slice(-30)
            .map((item) => `- ${item.type || "event"}: ${item.message || ""}`),
          "",
        ]
      : []),
  ].join("\n");

  await writeFile(bundlePath, `${JSON.stringify(output, null, 2)}\n`, {
    mode: 0o600,
  });
  await writeFile(briefPath, brief, { mode: 0o600 });
  return { directory, bundlePath, briefPath };
}

const server = http.createServer((request, response) => {
  const origin = request.headers.origin || "";
  if (origin && origin !== EXTENSION_ORIGIN) {
    respond(response, 403, { ok: false, error: "Origin is not allowed" });
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": EXTENSION_ORIGIN,
      "Access-Control-Allow-Headers": "Content-Type, X-Doppie-Assist",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/status") {
    respond(
      response,
      200,
      { ok: true, service: "doppie-assist", version: 1, waiting: true },
      origin,
    );
    return;
  }

  if (request.method !== "POST" || request.url !== "/annotations") {
    respond(response, 404, { ok: false, error: "Not found" }, origin);
    return;
  }
  if (request.headers["x-doppie-assist"] !== "browser-extension") {
    respond(response, 403, { ok: false, error: "Missing extension header" }, origin);
    return;
  }

  let size = 0;
  const chunks = [];
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) request.destroy(new Error("Bundle is too large"));
    else chunks.push(chunk);
  });
  request.on("error", (error) => {
    if (!response.headersSent)
      respond(response, 413, { ok: false, error: error.message }, origin);
  });
  request.on("end", async () => {
    try {
      const bundle = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const result = await materializeBundle(bundle);
      respond(response, 200, { ok: true, ...result }, origin);
      if (!finished) {
        finished = true;
        process.stdout.write(`DOPPIE_ASSIST_RESULT ${JSON.stringify(result)}\n`);
        setImmediate(() => server.close(() => process.exit(0)));
      }
    } catch (error) {
      respond(response, 400, { ok: false, error: error.message }, origin);
    }
  });
});

const timeout = setTimeout(() => {
  if (finished) return;
  process.stderr.write("Doppie Assist timed out waiting for browser annotations.\n");
  server.close(() => process.exit(2));
}, timeoutMs);
timeout.unref();

server.on("error", (error) => {
  if (error.code === "EADDRINUSE")
    process.stderr.write(`Port ${port} is already in use by another listener.\n`);
  else process.stderr.write(`${error.message}\n`);
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `Doppie Assist is waiting for browser annotations on 127.0.0.1:${port}.\n`,
  );
});
