const $ = (id) => document.getElementById(id);
let activeTab;
let latestCapture;
let currentPriority = 3;
let linearConfig;
let developerMode = false;
let latestRelease = null;
let updateCheckRunning = false;
const selectedLabelIds = new Set();

const escapeHtml = (value = "") =>
  value.replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );
const toast = (message) => {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2400);
};

function showCompose() {
  document.body.classList.remove("auth-required");
  $("settings-view").classList.add("hidden");
  $("compose-view").classList.remove("hidden");
}

function showSettings() {
  $("compose-view").classList.add("hidden");
  $("settings-view").classList.remove("hidden");
  if (isLinearConnected()) checkForUpdates();
}

function showAuthScreen() {
  document.body.classList.add("auth-required");
  $("routing-view").classList.add("hidden");
  $("drafts-view").classList.add("hidden");
  $("compose-view").classList.add("hidden");
  $("settings-view").classList.remove("hidden");
}

const versionParts = (value) =>
  String(value || "0")
    .replace(/^v/i, "")
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);

function isNewerVersion(candidate, current) {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if ((next[index] || 0) > (installed[index] || 0)) return true;
    if ((next[index] || 0) < (installed[index] || 0)) return false;
  }
  return false;
}

function trustedReleaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith("/iluk-ai/doppie-assist/releases/download/")
      ? url.href
      : "";
  } catch (_) {
    return "";
  }
}

function renderUpdateState(release = null) {
  const currentVersion = chrome.runtime.getManifest().version;
  const button = $("check-update");
  const status = $("update-status");
  latestRelease = release;
  button.disabled = false;
  button.classList.remove("available");
  button.dataset.action = "check";
  button.querySelector("span").textContent = "Check";
  if (!release) {
    status.innerHTML = `Version <b>${escapeHtml(currentVersion)}</b> installed`;
    return;
  }
  if (isNewerVersion(release.version, currentVersion)) {
    button.dataset.action = "download";
    button.classList.add("available");
    button.querySelector("span").textContent = `Download ${release.tagName}`;
    status.innerHTML = `<b>${escapeHtml(release.tagName)}</b> is ready to install`;
    return;
  }
  status.innerHTML = `Version <b>${escapeHtml(currentVersion)}</b> is up to date`;
}

async function checkForUpdates({ force = false } = {}) {
  if (updateCheckRunning) return;
  updateCheckRunning = true;
  const button = $("check-update");
  button.disabled = true;
  button.querySelector("span").textContent = "Checking...";
  $("update-status").textContent = "Checking GitHub Releases";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "check-for-updates",
      force,
    });
    if (!response?.ok)
      throw new Error(response?.error || "Could not check GitHub");
    renderUpdateState(response.release);
  } catch (error) {
    latestRelease = null;
    button.disabled = false;
    button.dataset.action = "check";
    button.querySelector("span").textContent = "Retry";
    $("update-status").textContent = error.message || "Could not check GitHub";
  } finally {
    updateCheckRunning = false;
  }
}

async function downloadLatestRelease() {
  if (!latestRelease?.downloadUrl) return checkForUpdates({ force: true });
  const downloadUrl = trustedReleaseUrl(latestRelease.downloadUrl);
  if (!downloadUrl) {
    latestRelease = null;
    return checkForUpdates({ force: true });
  }
  const button = $("check-update");
  button.disabled = true;
  button.querySelector("span").textContent = "Starting...";
  try {
    await chrome.downloads.download({
      url: downloadUrl,
      filename: latestRelease.assetName,
      saveAs: true,
    });
    $("update-status").innerHTML =
      "Unzip the package, replace the extension folder, then click <b>Reload</b> in chrome://extensions";
    button.querySelector("span").textContent = "Downloaded";
  } catch (error) {
    button.disabled = false;
    button.querySelector("span").textContent = `Download ${latestRelease.tagName}`;
    toast(error.message || "Could not download the update");
  }
}

async function copyText(value) {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_) {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

async function loadState() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const state = await chrome.storage.local.get([
    "captures",
    "issues",
    "linearConfig",
    "lastSelection",
    "pendingComposer",
    "developerMode",
  ]);
  latestCapture = state.captures?.[0];
  linearConfig = state.linearConfig;
  developerMode = Boolean(state.developerMode);
  $("developer-mode").checked = developerMode;
  if (linearConfig?.apiKey && !Array.isArray(linearConfig.users)) {
    const migrated = await chrome.runtime.sendMessage({
      type: "linear-connect",
      apiKey: linearConfig.apiKey,
    });
    if (migrated.ok) {
      linearConfig = { ...migrated };
      delete linearConfig.ok;
    }
  }

  $("page-title").textContent = activeTab?.title || "Current page";
  try {
    const url = new URL(activeTab.url);
    $("page-url").textContent = url.hostname.replace(/^www\./, "");
    $("page-favicon").textContent = url.hostname.charAt(0).toUpperCase();
  } catch (_) {
    $("page-url").textContent = "Active tab";
  }

  if (state.lastSelection?.url === activeTab?.url) {
    $("details").value = `Selected text:\n“${state.lastSelection.text}”`;
  }
  renderCapture();
  renderConnection();
  renderDrafts(state.issues || []);
  await renderShortcuts();
  renderUpdateState();
  checkForUpdates();

  if (!isLinearConnected()) showAuthScreen();

  const shouldOpenComposer =
    isLinearConnected() &&
    (state.pendingComposer ||
      new URLSearchParams(location.search).has("composer"));
  if (shouldOpenComposer) {
    await chrome.storage.local.remove("pendingComposer");
    requestAnimationFrame(() =>
      $("issue-title").focus({ preventScroll: true }),
    );
  }
}

function isLinearConnected() {
  return Boolean(linearConfig?.connected || linearConfig?.apiKey);
}

function renderCapture() {
  $("preview").classList.toggle("has-image", Boolean(latestCapture));
  if (!latestCapture) return;
  $("capture-image").src = latestCapture.dataUrl;
  $("capture-size").textContent = latestCapture.label
    ? `${latestCapture.label} · ${latestCapture.width} × ${latestCapture.height}`
    : `${latestCapture.width} × ${latestCapture.height} capture`;
}

function renderConnection() {
  const connected = isLinearConnected();
  document.body.classList.toggle("auth-required", !connected);
  $("connection-status").classList.toggle("connected", connected);
  $("connection-status").innerHTML =
    `<i></i>${connected ? escapeHtml(linearConfig.viewer?.name || "Linear connected") : "Local mode"}`;
  $("connection-card").classList.toggle("hidden", !connected);
  $("connection-actions").classList.toggle("hidden", connected);
  if (connected) {
    $("viewer-name").textContent = linearConfig.viewer?.name || "Connected";
    $("connection-method").textContent =
      linearConfig.authType === "oauth" ? "OAuth" : "API key";
    $("team-count").textContent =
      `${linearConfig.teams?.length || 0} teams available`;
    $("connection-privacy").textContent =
      linearConfig.authType === "oauth"
        ? "OAuth refreshes automatically in this browser profile."
        : "API key stored in this browser profile.";
  } else {
    $("connection-privacy").textContent =
      "Choose OAuth or use a personal API key.";
  }
  $("team").innerHTML = connected
    ? (linearConfig.teams || [])
        .map(
          (team) =>
            `<option value="${team.id}">${escapeHtml(team.name)}</option>`,
        )
        .join("")
    : '<option value="">Connect Linear</option>';
  renderRouting();
}

function renderRouting() {
  const previousAssignee = $("assignee").value;
  const previousProject = $("project").value;
  const users = [...(linearConfig?.users || [])].sort((a, b) =>
    (a.displayName || a.name).localeCompare(b.displayName || b.name),
  );
  const projects = [...(linearConfig?.projects || [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  $("assignee").innerHTML = [
    '<option value="">No assignee</option>',
    ...users.map(
      (user) =>
        `<option value="${user.id}">${escapeHtml(user.displayName || user.name)}</option>`,
    ),
  ].join("");
  $("project").innerHTML = [
    '<option value="">No project</option>',
    ...projects.map(
      (project) =>
        `<option value="${project.id}">${escapeHtml(project.name)}</option>`,
    ),
  ].join("");
  if (users.some((user) => user.id === previousAssignee))
    $("assignee").value = previousAssignee;
  if (projects.some((project) => project.id === previousProject))
    $("project").value = previousProject;
  renderLabelList();
  updateRoutingSummary();
}

function renderLabelList(filter = "") {
  const query = filter.trim().toLowerCase();
  const labels = (linearConfig?.labels || [])
    .filter((label) => !query || label.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));
  $("label-list").innerHTML = labels.length
    ? labels
        .map((label) => {
          const color = /^#[0-9a-f]{6}$/i.test(label.color || "")
            ? label.color
            : "#8a918b";
          return `<label class="label-option"><input type="checkbox" value="${label.id}" ${selectedLabelIds.has(label.id) ? "checked" : ""}><i class="label-color" style="background:${color}"></i><span>${escapeHtml(label.name)}</span></label>`;
        })
        .join("")
    : `<div class="empty-labels">${isLinearConnected() ? "No matching labels" : "Connect Linear to load labels"}</div>`;
  $("label-list")
    .querySelectorAll('input[type="checkbox"]')
    .forEach((checkbox) =>
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedLabelIds.add(checkbox.value);
        else selectedLabelIds.delete(checkbox.value);
        updateRoutingSummary();
      }),
    );
}

function updateRoutingSummary() {
  const count =
    Number(Boolean($("assignee").value)) +
    Number(Boolean($("project").value)) +
    selectedLabelIds.size;
  $("routing-count").textContent = count;
  $("routing-summary").textContent = count
    ? `${count} routing ${count === 1 ? "field" : "fields"} set`
    : "Assignee, project & labels";
}

async function renderShortcuts() {
  const commands = await chrome.commands.getAll();
  const region = commands.find((command) => command.name === "capture-region");
  const element = commands.find(
    (command) => command.name === "capture-element",
  );
  const regionKey = region?.shortcut || "Not set";
  const elementKey = element?.shortcut || "Not set";
  $("region-shortcut").textContent = regionKey;
  $("element-shortcut").textContent = elementKey;
  $("settings-region-shortcut").textContent = regionKey;
  $("settings-element-shortcut").textContent = elementKey;
}

function renderDrafts(issues) {
  $("draft-count").textContent = issues.length;
  $("draft-list").innerHTML = issues.length
    ? issues
        .map(
          (issue) => `
    <article class="draft">
      ${issue.capture ? `<img src="${issue.capture}" alt="">` : '<span class="draft-placeholder"></span>'}
      <div><strong>${escapeHtml(issue.title)}</strong><p>${issue.identifier ? `<a href="${escapeHtml(issue.url)}" target="_blank">${escapeHtml(issue.identifier)}</a>` : "Local draft"} · ${escapeHtml(issue.createdAt)}</p></div>
    </article>`,
        )
        .join("")
    : '<div class="empty-drafts">Your captured issues will collect here.</div>';
}

async function launchCapture(type) {
  if (!activeTab?.id || !/^https?:/.test(activeTab.url || ""))
    return toast("Open a regular web page to capture it");
  try {
    await chrome.tabs.sendMessage(activeTab.id, { type });
    window.close();
  } catch (_) {
    toast("Refresh this page once, then try again");
  }
}

$("start-capture").addEventListener("click", () =>
  launchCapture("start-target-capture"),
);
$("start-element-capture").addEventListener("click", () =>
  launchCapture("start-multi-annotation"),
);

$("remove-capture").addEventListener("click", async () => {
  const { captures = [] } = await chrome.storage.local.get("captures");
  const index = latestCapture
    ? captures.findIndex(
        (capture) => capture.createdAt === latestCapture.createdAt,
      )
    : -1;
  if (index >= 0) captures.splice(index, 1);
  latestCapture = null;
  await chrome.storage.local.set({ captures });
  renderCapture();
});

document.querySelectorAll("#priority button").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("#priority button")
      .forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    currentPriority = Number(button.dataset.value);
  }),
);

$("issue-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = $("issue-title").value.trim();
  if (!title) return toast("Add an issue title");
  const sourceUrl = latestCapture?.url || activeTab?.url;
  const details = $("details").value.trim();
  const localDescription = [details, sourceUrl ? `Source: ${sourceUrl}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const description = DoppieIssueFormat.buildIssueDescription({
    issueTitle: title,
    request: details || title,
    pageTitle: latestCapture?.title || activeTab?.title,
    url: sourceUrl,
    mode: latestCapture?.mode || "page",
    label: latestCapture?.label,
    captureWidth: latestCapture?.width,
    captureHeight: latestCapture?.height,
  });
  let created;
  const createLabel = $("create-issue").querySelector("span");
  const idleLabel = createLabel.textContent;
  $("create-issue").disabled = true;
  createLabel.textContent = isLinearConnected()
    ? latestCapture
      ? "Uploading screenshot..."
      : "Creating issue..."
    : "Saving draft...";
  try {
    if (isLinearConnected()) {
      const input = {
        title,
        description,
        teamId: $("team").value,
        priority: currentPriority,
      };
      if ($("assignee").value) input.assigneeId = $("assignee").value;
      if ($("project").value) input.projectId = $("project").value;
      if (selectedLabelIds.size) input.labelIds = [...selectedLabelIds];
      const response = await chrome.runtime.sendMessage({
        type: "create-linear-issue",
        input,
        screenshot: latestCapture?.dataUrl?.startsWith("data:image/")
          ? latestCapture.dataUrl
          : "",
        screenshotName: `doppie-capture-${Date.now()}.jpg`,
      });
      if (!response.ok) throw new Error(response.error);
      created = response.issue;
    }
    const { issues = [] } = await chrome.storage.local.get("issues");
    const issue = {
      title,
      description: localDescription,
      capture: latestCapture?.dataUrl,
      identifier: created?.identifier,
      url: created?.url,
      assignee: $("assignee").selectedOptions[0]?.text || "",
      project: $("project").selectedOptions[0]?.text || "",
      labels: [...selectedLabelIds],
      createdAt: new Date().toLocaleDateString(),
    };
    issues.unshift(issue);
    await chrome.storage.local.set({ issues: issues.slice(0, 30) });
    renderDrafts(issues);
    $("issue-title").value = "";
    $("details").value = "";
    const copied = created?.url ? await copyText(created.url) : false;
    toast(
      created
        ? `${created.identifier} created${copied ? " · Link copied" : " in Linear"}`
        : "Saved as a local draft",
    );
  } catch (error) {
    toast(error.message || "Could not create issue");
  } finally {
    $("create-issue").disabled = false;
    createLabel.textContent = idleLabel;
  }
});

$("open-settings").addEventListener("click", showSettings);
$("close-settings").addEventListener("click", showCompose);
$("connect-oauth").addEventListener("click", async () => {
  const button = $("connect-oauth");
  const label = button.querySelector(".oauth-label");
  const idleLabel = label.lastChild.textContent;
  button.disabled = true;
  label.lastChild.textContent = "Waiting for Linear...";
  const response = await chrome.runtime.sendMessage({
    type: "linear-oauth-connect",
  });
  button.disabled = false;
  label.lastChild.textContent = idleLabel;
  if (!response.ok) return toast(response.error || "Connection failed");
  linearConfig = { ...response };
  delete linearConfig.ok;
  renderConnection();
  showCompose();
  checkForUpdates();
  toast("Linear connected with OAuth");
});
$("connect-api-key").addEventListener("click", async () => {
  const apiKey = $("api-key").value.trim();
  if (!apiKey) return toast("Enter your Linear API key");
  $("connect-api-key").disabled = true;
  const response = await chrome.runtime.sendMessage({
    type: "linear-connect",
    apiKey,
  });
  $("connect-api-key").disabled = false;
  if (!response.ok) return toast(response.error || "Connection failed");
  linearConfig = { ...response };
  delete linearConfig.ok;
  renderConnection();
  showCompose();
  checkForUpdates();
  toast("Linear connected with API key");
});
$("disconnect").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: "linear-disconnect",
  });
  if (!response.ok) return toast(response.error || "Could not disconnect");
  linearConfig = null;
  selectedLabelIds.clear();
  $("api-key").value = "";
  renderConnection();
  showAuthScreen();
});
$("open-routing").addEventListener("click", () => {
  $("routing-view").classList.remove("hidden");
  $("label-search").focus();
});
$("close-routing").addEventListener("click", () =>
  $("routing-view").classList.add("hidden"),
);
$("save-routing").addEventListener("click", () => {
  updateRoutingSummary();
  $("routing-view").classList.add("hidden");
});
$("assignee").addEventListener("change", updateRoutingSummary);
$("project").addEventListener("change", updateRoutingSummary);
$("label-search").addEventListener("input", (event) =>
  renderLabelList(event.target.value),
);
$("edit-shortcuts").addEventListener("click", () =>
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" }),
);
$("developer-mode").addEventListener("change", async (event) => {
  developerMode = event.target.checked;
  await chrome.storage.local.set({ developerMode });
  toast(developerMode ? "Developer context enabled" : "Developer context disabled");
});
$("check-update").addEventListener("click", () => {
  if ($("check-update").dataset.action === "download")
    downloadLatestRelease();
  else checkForUpdates({ force: true });
});
$("inbox-tab").addEventListener("click", () =>
  $("drafts-view").classList.remove("hidden"),
);
$("close-drafts").addEventListener("click", () =>
  $("drafts-view").classList.add("hidden"),
);
$("compose-tab").addEventListener("click", () =>
  $("drafts-view").classList.add("hidden"),
);
document.addEventListener("keydown", (event) => {
  if (
    event.key.toLowerCase() === "c" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
  )
    $("start-capture").click();
});

loadState().catch(() => toast("Could not read the active page"));
