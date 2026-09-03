let selectedText = "";
let activeReviewSession = null;

document.addEventListener("mouseup", () => {
  if (
    document.querySelector(
      ".margin-capture-layer, .margin-element-layer, .margin-editor-layer, .doppie-review-layer",
    )
  )
    return;
  const selection = window.getSelection();
  selectedText = selection?.toString().trim() || "";
  if (selectedText.length > 2) {
    chrome.runtime.sendMessage({
      type: "selection",
      text: selectedText,
      url: location.href,
      title: document.title,
    });
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "start-target-capture") startTargetCapture();
  if (
    ["start-element-capture", "start-multi-annotation"].includes(message.type)
  )
    startMultiAnnotation();
  if (message.type === "highlight" && selectedText)
    highlightSelection(message.note);
});

function highlightSelection(note) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const mark = document.createElement("mark");
  mark.className = "margin-highlight";
  mark.title = note || "Doppie Assist annotation";
  try {
    selection.getRangeAt(0).surroundContents(mark);
  } catch (_) {
    return;
  }
  selection.removeAllRanges();
  showPageToast("Annotation pinned to this page");
}

function startTargetCapture() {
  document.querySelector(".margin-capture-layer")?.remove();
  const layer = document.createElement("div");
  layer.className = "margin-capture-layer";
  layer.innerHTML = `
    <div class="margin-capture-tip"><span class="margin-target"></span><strong>Drag to capture</strong><small>Press Esc to cancel</small></div>
    <div class="margin-selection-box"><span></span><span></span><span></span><span></span><b></b></div>`;
  document.documentElement.appendChild(layer);
  const box = layer.querySelector(".margin-selection-box");
  let origin = null;
  let rect = null;

  const cleanup = () => {
    layer.remove();
    document.removeEventListener("keydown", onKeyDown, true);
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") cleanup();
  };
  document.addEventListener("keydown", onKeyDown, true);

  layer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    origin = { x: event.clientX, y: event.clientY };
    layer.setPointerCapture(event.pointerId);
    box.classList.add("visible");
  });

  layer.addEventListener("pointermove", (event) => {
    if (!origin) return;
    rect = normalizeRect(origin.x, origin.y, event.clientX, event.clientY);
    Object.assign(box.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    box.querySelector("b").textContent =
      `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  });

  layer.addEventListener("pointerup", async (event) => {
    if (!origin) return;
    rect = normalizeRect(origin.x, origin.y, event.clientX, event.clientY);
    origin = null;
    if (rect.width < 24 || rect.height < 24) return cleanup();
    cleanup();
    await captureAndEdit(rect, { mode: "region", label: "Selected region" });
  });
}

function doppieUiIcon(name) {
  const icons = {
    review:
      '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9"/><path d="M8 3v4h8V3"/><path d="m16 13 2 2 4-4"/>',
    team: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    priority:
      '<path d="M4 20v-4"/><path d="M10 20V10"/><path d="M16 20V4"/><path d="M22 20V8"/>',
    assignee: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    project:
      '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    labels:
      '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42Z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    issue:
      '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    request:
      '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
    record: '<circle cx="12" cy="12" r="7" fill="currentColor"/>',
    template:
      '<path d="M4 4h16v16H4z"/><path d="M8 8h8"/><path d="M8 12h5"/><path d="M8 16h3"/>',
    terminal:
      '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    parent: '<path d="m18 15-6-6-6 6"/>',
    child: '<path d="m6 9 6 6 6-6"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    viewport:
      '<rect width="18" height="14" x="3" y="4" rx="2"/><path d="M8 22h8"/><path d="M12 18v4"/>',
    imageOff:
      '<path d="m2 2 20 20"/><path d="M10.4 10.4 4 17h13"/><path d="M14.5 14.5 21 8v9a2 2 0 0 1-2 2H8"/><path d="M3 3v12"/>',
  };
  return `<svg class="doppie-ui-icon" aria-hidden="true" viewBox="0 0 24 24">${icons[name] || ""}</svg>`;
}

async function startMultiAnnotation() {
  if (activeReviewSession) {
    activeReviewSession.focus();
    return;
  }

  const { linearConfig, activeReviewSessionDraft } =
    await chrome.storage.local.get(["linearConfig", "activeReviewSessionDraft"]);
  const draftIsCurrent =
    activeReviewSessionDraft?.origin === location.origin &&
    Date.now() - activeReviewSessionDraft.updatedAt < 8 * 60 * 60 * 1000;
  const restoredDraft = draftIsCurrent ? activeReviewSessionDraft : null;
  const linearConnected = Boolean(
    linearConfig?.connected || linearConfig?.apiKey,
  );
  const annotations = (restoredDraft?.annotations || []).map((annotation) => {
    let element = null;
    if (annotation.pageUrl === location.href)
      element =
        DoppieDevContext.resolve(annotation.developerContext) ||
        DoppieDevContext.resolve({
          selector: { primary: annotation.selector, alternatives: [] },
        });
    return {
      ...annotation,
      element,
      status: annotation.status === "creating" ? "pending" : annotation.status,
    };
  });
  const diagnostics = [...(restoredDraft?.diagnostics || [])];
  const networkRequests = [...(restoredDraft?.networkRequests || [])];
  const sessionEvents = [...(restoredDraft?.sessionEvents || [])];
  const reproductionSteps = [...(restoredDraft?.reproductionSteps || [])];
  let sessionVideo = restoredDraft?.sessionVideo || null;
  let videoActive = false;
  let videoStarting = false;
  let recording = Boolean(restoredDraft?.recording);
  let parentMode = Boolean(restoredDraft?.parentMode);
  let parentIssue = restoredDraft?.parentIssue || null;
  let flowIssue = restoredDraft?.flowIssue || null;
  let sharedRoutingDraft = restoredDraft?.sharedRouting || null;
  let defaultFeedbackType = restoredDraft?.defaultFeedbackType || "ui";
  let devBridgeConnected = false;
  let agentHandoff = restoredDraft?.agentHandoff || null;
  const flowDraft = {
    title: `Recorded flow: ${document.title}`,
    request: "Review the recorded flow and resolve the captured behavior.",
    feedbackType: "bug",
    ...(restoredDraft?.flowDraft || {}),
  };
  const sessionId = restoredDraft?.id || crypto.randomUUID();
  const sessionStartedAt = restoredDraft?.createdAt || Date.now();
  let target = null;
  let hoverOrigin = null;
  let targetStack = [];
  let targetStackIndex = 0;
  let editingId = null;
  let reviewEditingId = null;
  let refreshQueued = false;
  let persistTimer = null;
  let stepCaptureQueue = Promise.resolve();
  let bridgeCheckTimer = null;
  let bridgeChecking = false;
  const shortcutLabel = /Mac|iPhone|iPad|iPod/i.test(
    navigator.userAgentData?.platform || navigator.platform || "",
  )
    ? "⌘↵"
    : "Ctrl↵";
  const feedbackOptions = Object.entries(DoppieIssueFormat.FEEDBACK_TYPES)
    .map(
      ([value, item]) =>
        `<option value="${value}">${escapeMarkup(item.label)}</option>`,
    )
    .join("");

  const layer = document.createElement("div");
  layer.className = "doppie-review-layer";
  layer.innerHTML = `
    <div class="doppie-review-tip">
      <img src="${chrome.runtime.getURL("assets/icon-32.png")}" alt="">
      <span><strong>Review mode</strong><small>Pick an element · Alt + scroll selects parents</small></span>
      <b class="doppie-dev-status" data-dev-status>Dev</b>
    </div>
    <div class="doppie-hover-box"><b></b><small></small></div>
    <div class="doppie-pins"></div>
    <section class="doppie-note-popover" aria-label="Element annotation">
      <header><span class="doppie-note-number">1</span><div><strong>Add feedback</strong><small></small></div><button data-note-action="child" aria-label="Select child element" title="Select child element">${doppieUiIcon("child")}</button><button data-note-action="parent" aria-label="Select parent element" title="Select parent element">${doppieUiIcon("parent")}</button><button data-note-action="close" aria-label="Close">×</button></header>
      <label class="doppie-note-type"><span>Feedback type</span><select>${feedbackOptions}</select></label>
      <fieldset class="doppie-note-capture"><legend>Screenshot</legend><div><button type="button" data-capture-mode="element">${doppieUiIcon("crop")}Element</button><button type="button" data-capture-mode="viewport">${doppieUiIcon("viewport")}Viewport</button><button type="button" data-capture-mode="none">${doppieUiIcon("imageOff")}None</button></div></fieldset>
      <textarea rows="4" maxlength="1200" placeholder="Describe what should change..."></textarea>
      <p class="doppie-note-error" role="alert"></p>
      <footer><button data-note-action="remove" class="doppie-note-remove">Remove</button><span></span><button data-note-action="cancel">Cancel</button><button data-note-action="save" class="doppie-note-save" aria-keyshortcuts="Meta+Enter Control+Enter"><span>Add annotation</span><kbd>${shortcutLabel}</kbd></button></footer>
    </section>
    <section class="doppie-review-panel" aria-label="Review annotations">
      <header><span class="doppie-panel-icon">${doppieUiIcon("review")}</span><div><small>PAGE REVIEW</small><strong>Ready for Linear</strong></div><button data-panel-action="close" aria-label="Close">×</button></header>
      <div class="doppie-review-list"></div>
      <div class="doppie-review-options">
        <label><input type="checkbox" data-review-option="parent" ${parentMode ? "checked" : ""}><span><strong>Group under parent issue</strong><small>One review summary with child issues</small></span></label>
        <div><b data-diagnostic-count>${diagnostics.length}</b> diagnostics <span>·</span> <b data-network-count>${networkRequests.length}</b> requests <span>·</span> <b data-step-count>${reproductionSteps.length}</b> steps</div>
      </div>
      <details class="doppie-context-preview"><summary>Captured context</summary><div><div class="doppie-video-context" data-context-video hidden><strong>Flow video</strong><video controls muted playsinline preload="metadata"></video><small></small></div><strong>Reproduction</strong><ol data-context-steps></ol><strong>Network</strong><ul data-context-network></ul><strong>Session events</strong><ul data-context-events></ul><strong>Diagnostics</strong><ul data-context-diagnostics></ul></div></details>
      <div class="doppie-routing">
        <label><span class="doppie-field-label">${doppieUiIcon("team")}Team</span><select data-route="team"></select></label>
        <label><span class="doppie-field-label">${doppieUiIcon("priority")}Priority</span><select data-route="priority"><option value="3">Normal</option><option value="2">High</option><option value="1">Urgent</option><option value="4">Low</option></select></label>
        <label><span class="doppie-field-label">${doppieUiIcon("assignee")}Assignee</span><select data-route="assignee"></select></label>
        <label><span class="doppie-field-label">${doppieUiIcon("project")}Project</span><select data-route="project"></select></label>
        <fieldset><legend class="doppie-field-label">${doppieUiIcon("labels")}Labels</legend><div class="doppie-label-options"></div></fieldset>
      </div>
      <p class="doppie-panel-message" role="status"></p>
      <div class="doppie-submit-actions"><button class="doppie-send-agent" data-panel-action="send-agent">${doppieUiIcon("terminal")}<span>Send to coding agent</span></button><button class="doppie-submit-review" data-panel-action="submit">Create Linear issues</button></div>
    </section>
    <footer class="doppie-session-bar">
      <div><img src="${chrome.runtime.getURL("assets/icon-32.png")}" alt=""><span><strong>Page review</strong><small><b data-count>0</b> annotations</small></span></div>
      <button class="doppie-record-button" data-session-action="record">${doppieUiIcon("record")}<span>${recording ? "Stop recording" : "Record flow"}</span><b>${reproductionSteps.length}</b></button>
      <span class="doppie-session-spacer"></span>
      <button data-session-action="cancel">Cancel</button>
      <button class="doppie-review-button" data-session-action="review" disabled><span>Review issues</span> <b>0</b></button>
    </footer>`;
  document.documentElement.appendChild(layer);
  document.documentElement.classList.add("doppie-reviewing");

  const hoverBox = layer.querySelector(".doppie-hover-box");
  const hoverLabel = hoverBox.querySelector("b");
  const hoverSize = hoverBox.querySelector("small");
  const popover = layer.querySelector(".doppie-note-popover");
  const noteText = popover.querySelector("textarea");
  const noteType = popover.querySelector(".doppie-note-type select");
  const noteError = popover.querySelector(".doppie-note-error");
  const panel = layer.querySelector(".doppie-review-panel");
  const panelMessage = panel.querySelector(".doppie-panel-message");
  const reviewButton = layer.querySelector('[data-session-action="review"]');
  const recordButton = layer.querySelector('[data-session-action="record"]');
  const submitButton = layer.querySelector('[data-panel-action="submit"]');
  const sendAgentButton = layer.querySelector(
    '[data-panel-action="send-agent"]',
  );

  const isReviewUi = (element) =>
    element?.closest?.(
      ".doppie-review-layer, .margin-capture-layer, .margin-element-layer, .margin-editor-layer, .margin-toast",
    );
  const getAnnotation = (id) =>
    annotations.find((annotation) => annotation.id === id);

  function serializableAnnotations() {
    return annotations.map(({ element, ...annotation }) => annotation);
  }

  function persistSession(immediate = false) {
    clearTimeout(persistTimer);
    const save = () =>
      chrome.storage.local.set({
        activeReviewSessionDraft: {
          id: sessionId,
          origin: location.origin,
          currentUrl: location.href,
          createdAt: sessionStartedAt,
          updatedAt: Date.now(),
          annotations: serializableAnnotations(),
          diagnostics: diagnostics.slice(-60),
          networkRequests: networkRequests.slice(-100),
          sessionEvents: sessionEvents.slice(-80),
          reproductionSteps: reproductionSteps.slice(-20),
          sessionVideo,
          recording,
          parentMode,
          parentIssue,
          flowIssue,
          flowDraft,
          defaultFeedbackType,
          agentHandoff,
          sharedRouting: panel.querySelector('[data-route="team"]').options
            .length
            ? getSharedRouting()
            : sharedRoutingDraft,
        },
      });
    if (immediate) return save();
    persistTimer = setTimeout(save, 80);
    return Promise.resolve();
  }

  function clearSavedSession() {
    clearTimeout(persistTimer);
    return chrome.storage.local.remove("activeReviewSessionDraft");
  }

  async function copyIssueLinks() {
    const urls = [
      ...(parentIssue?.url ? [parentIssue.url] : []),
      ...(flowIssue?.url ? [flowIssue.url] : []),
      ...annotations
        .filter((annotation) => annotation.issue?.url)
        .map((annotation) => annotation.issue.url),
    ];
    if (!urls.length) return false;
    const value = [...new Set(urls)].join("\n");
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_) {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.documentElement.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      return copied;
    }
  }

  function renderRecordingState() {
    document.documentElement.classList.toggle("doppie-reviewing", !recording);
    document.documentElement.classList.toggle("doppie-recording", recording);
    recordButton.classList.toggle("recording", recording);
    recordButton.querySelector("span").textContent = recording
      ? "Stop & save video"
      : "Record flow";
    recordButton.querySelector("b").textContent = reproductionSteps.length;
    layer.querySelector(".doppie-review-tip strong").textContent = recording
      ? "Recording flow"
      : "Review mode";
    layer.querySelector(".doppie-review-tip small").textContent = recording
      ? "Interactions, requests, and tab video are being captured"
      : "Pick an element · Alt + scroll selects parents";
    if (recording) hoverBox.classList.remove("visible", "selected");
  }

  function recordStep(action, element = null, type = "action") {
    if (reproductionSteps.length >= 20) return;
    const step = {
      id: crypto.randomUUID(),
      type,
      action,
      selector: element ? buildElementSelector(element) : "",
      label: element ? describeElement(element) : "",
      url: location.href,
      pageTitle: document.title,
      at: Date.now(),
      screenshot: "",
    };
    reproductionSteps.push(step);
    renderSession();
    persistSession(true);
    if (reproductionSteps.filter((item) => item.screenshot).length >= 6) return;
    stepCaptureQueue = stepCaptureQueue.then(
      () =>
        new Promise((resolve) => {
          setTimeout(async () => {
            try {
              if (!document.contains(layer)) return;
              layer.style.visibility = "hidden";
              await nextPaint();
              let response;
              try {
                response = await chrome.runtime.sendMessage({
                  type: "capture-visible-tab",
                });
              } finally {
                layer.style.visibility = "";
              }
              if (response?.ok) {
                const crop = await cropScreenshot(response.dataUrl, {
                  x: 0,
                  y: 0,
                  width: window.innerWidth,
                  height: window.innerHeight,
                });
                step.screenshot = crop.dataUrl;
                persistSession(true);
              }
            } catch (_) {
              layer.style.visibility = "";
            } finally {
              resolve();
            }
          }, 120);
        }),
    );
  }

  async function setRecording(nextRecording) {
    if (videoStarting) return;
    recording = nextRecording;
    closeNote();
    closePanel();
    renderRecordingState();
    if (recording) {
      recordStep(
        `Start on ${location.pathname}${location.search}${location.hash}`,
        null,
        "start",
      );
      videoStarting = true;
      recordButton.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage({
          type: "start-flow-video",
          sessionId,
        });
        if (!response?.ok)
          throw new Error(response?.error || "Could not start tab video");
        videoActive = true;
        sessionVideo = null;
      } catch (error) {
        videoActive = false;
        showPageToast(
          `${error.message || "Video capture unavailable"}. Flow events are still recording.`,
        );
      } finally {
        videoStarting = false;
        recordButton.disabled = false;
        persistSession(true);
      }
    } else {
      if (videoActive) {
        videoStarting = true;
        recordButton.disabled = true;
        try {
          const response = await chrome.runtime.sendMessage({
            type: "stop-flow-video",
            sessionId,
          });
          if (!response?.ok)
            throw new Error(response?.error || "Could not finish tab video");
          sessionVideo = response.video || null;
        } catch (error) {
          showPageToast(error.message || "Could not save the flow video");
        } finally {
          videoActive = false;
          videoStarting = false;
          recordButton.disabled = false;
        }
      }
      persistSession(true);
      showPageToast(
        `${reproductionSteps.length} reproduction ${reproductionSteps.length === 1 ? "step" : "steps"}${sessionVideo ? " and video" : ""} saved.`,
      );
    }
  }

  async function restoreRecordingState() {
    if (!recording) return;
    videoStarting = true;
    recordButton.disabled = true;
    renderRecordingState();
    try {
      const response = await chrome.runtime.sendMessage({
        type: "flow-video-status",
        sessionId,
      });
      if (!response?.ok)
        throw new Error(response?.error || "Could not restore flow recording");
      videoActive =
        Boolean(response.recording) && response.sessionId === sessionId;
      if (!videoActive) {
        recording = false;
        if (response.video?.sessionId === sessionId) {
          sessionVideo = response.video;
          showPageToast("The 90-second flow video was saved automatically.");
        } else {
          showPageToast("Flow recording stopped during navigation.");
        }
      }
    } catch (_) {
      recording = false;
      videoActive = false;
    } finally {
      videoStarting = false;
      recordButton.disabled = false;
      renderRecordingState();
      persistSession(true);
    }
  }

  function onDiagnosticEvent(event) {
    let item;
    try {
      item = JSON.parse(event.detail);
    } catch (_) {
      return;
    }
    if (item.type === "navigation" && recording)
      recordStep(item.message, null, "navigation");
    const collection =
      item.category === "network"
        ? networkRequests
        : item.category === "event"
          ? sessionEvents
          : diagnostics;
    collection.push(item);
    const limit =
      collection === networkRequests
        ? 100
        : collection === sessionEvents
          ? 80
          : 60;
    if (collection.length > limit)
      collection.splice(0, collection.length - limit);
    renderSession();
    persistSession();
  }

  function onRecordedClick(event) {
    if (!recording || isReviewUi(event.target)) return;
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;
    const text = getElementText(element).slice(0, 80);
    recordStep(
      `Click ${text ? `“${text}”` : describeElement(element)}`,
      element,
      "click",
    );
  }

  function onRecordedChange(event) {
    if (!recording || isReviewUi(event.target)) return;
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;
    recordStep(
      `Change ${element.getAttribute("aria-label") || element.getAttribute("name") || describeElement(element)}`,
      element,
      "input",
    );
  }

  function buildTargetStack(element) {
    const stack = [];
    let current = element;
    while (
      current instanceof Element &&
      !isReviewUi(current) &&
      current !== document.documentElement
    ) {
      stack.push(current);
      current = current.parentElement;
    }
    return stack;
  }

  function setTargetElement(element, { resetStack = true } = {}) {
    if (!element?.isConnected) return false;
    if (resetStack) {
      hoverOrigin = element;
      targetStack = buildTargetStack(element);
      targetStackIndex = 0;
    }
    target = element;
    if (popover.classList.contains("visible")) {
      popover.querySelector("header small").textContent = describeElement(target);
      positionPopover(target);
    }
    updateTargetControls();
    updateHoverBox();
    return true;
  }

  function updateTargetControls() {
    const child = popover.querySelector('[data-note-action="child"]');
    const parent = popover.querySelector('[data-note-action="parent"]');
    child.disabled = targetStackIndex <= 0;
    parent.disabled = targetStackIndex >= targetStack.length - 1;
  }

  function cycleTarget(direction) {
    if (!targetStack.length) return;
    const nextIndex = Math.max(
      0,
      Math.min(targetStack.length - 1, targetStackIndex + direction),
    );
    if (nextIndex === targetStackIndex) return;
    targetStackIndex = nextIndex;
    setTargetElement(targetStack[targetStackIndex], { resetStack: false });
  }

  function renderDeveloperState() {
    document.documentElement.classList.add("doppie-developer-mode");
    const status = layer.querySelector("[data-dev-status]");
    status.classList.add("active");
    status.classList.toggle("connected", devBridgeConnected);
    status.textContent = devBridgeConnected
      ? "Agent connected"
      : "Context auto";
    const hasReview = Boolean(
      annotations.length || reproductionSteps.length || diagnostics.length,
    );
    sendAgentButton.disabled = !devBridgeConnected || !hasReview;
    sendAgentButton.querySelector("span").textContent = agentHandoff
      ? "Sent to coding agent"
      : devBridgeConnected
        ? "Send to coding agent"
        : "Waiting for terminal";
    sendAgentButton.title = devBridgeConnected
      ? "Send this review to the waiting Doppie Assist skill"
      : "Run $doppie-assist in Codex first";
  }

  async function refreshDevBridgeStatus() {
    if (bridgeChecking || !document.contains(layer)) return;
    bridgeChecking = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "dev-bridge-status",
      });
      const connected = Boolean(response?.connected);
      devBridgeConnected = connected;
      renderDeveloperState();
    } catch (_) {
      devBridgeConnected = false;
      renderDeveloperState();
    } finally {
      bridgeChecking = false;
    }
  }

  function updateHoverBox() {
    if (!target?.isConnected) {
      hoverBox.classList.remove("visible");
      hoverBox.classList.remove("selected");
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    Object.assign(hoverBox.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.max(1, Math.min(window.innerWidth - left, rect.width))}px`,
      height: `${Math.max(1, Math.min(window.innerHeight - top, rect.height))}px`,
    });
    hoverLabel.textContent = describeElement(target);
    hoverSize.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    hoverBox.classList.toggle("badge-below", rect.top < 46);
    hoverBox.classList.toggle(
      "selected",
      popover.classList.contains("visible"),
    );
    hoverBox.classList.add("visible");
  }

  function positionPopover(element) {
    const rect = element.getBoundingClientRect();
    const width = 304;
    const estimatedHeight = 252;
    const sessionBarClearance = 88;
    const preferredLeft = rect.right + 12;
    const left =
      preferredLeft + width <= window.innerWidth - 12
        ? preferredLeft
        : Math.max(
            12,
            Math.min(rect.left - width - 12, window.innerWidth - width - 12),
          );
    const top = Math.max(
      12,
      Math.min(
        rect.top,
        window.innerHeight - estimatedHeight - sessionBarClearance,
      ),
    );
    Object.assign(popover.style, { left: `${left}px`, top: `${top}px` });
  }

  function openNote(element, annotation = null) {
    if (!element?.isConnected) return;
    setTargetElement(element);
    editingId = annotation?.id || null;
    popover.querySelector("header small").textContent =
      describeElement(element);
    popover.querySelector(".doppie-note-number").textContent = annotation
      ? String(annotations.indexOf(annotation) + 1)
      : String(annotations.length + 1);
    popover
      .querySelector('[data-note-action="remove"]')
      .classList.toggle("visible", Boolean(annotation));
    popover.querySelector('[data-note-action="save"] span').textContent =
      annotation ? "Save changes" : "Add annotation";
    noteType.value = annotation?.feedbackType || defaultFeedbackType;
    noteText.value = annotation?.note || "";
    const captureMode = annotation?.screenshotMode || "element";
    popover.querySelectorAll("[data-capture-mode]").forEach((button) =>
      button.classList.toggle(
        "active",
        button.dataset.captureMode === captureMode,
      ),
    );
    noteError.textContent = "";
    positionPopover(element);
    popover.classList.add("visible");
    updateHoverBox();
    requestAnimationFrame(() => noteText.focus({ preventScroll: true }));
  }

  function closeNote() {
    popover.classList.remove("visible");
    editingId = null;
    noteError.textContent = "";
    target = null;
    hoverOrigin = null;
    targetStack = [];
    targetStackIndex = 0;
    hoverBox.classList.remove("visible", "selected");
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      updateHoverBox();
      updatePins();
      if (popover.classList.contains("visible") && target?.isConnected)
        positionPopover(target);
    });
  }

  function updatePins() {
    const pins = layer.querySelector(".doppie-pins");
    pins.innerHTML = "";
    annotations.forEach((annotation, index) => {
      if (!annotation.element?.isConnected) return;
      const rect = annotation.element.getBoundingClientRect();
      if (
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      )
        return;
      const pin = document.createElement("button");
      pin.className = `doppie-annotation-pin ${annotation.status || ""}`;
      pin.textContent = String(index + 1);
      pin.title = annotation.note;
      pin.style.left = `${Math.max(10, Math.min(window.innerWidth - 38, rect.right - 15))}px`;
      pin.style.top = `${Math.max(10, Math.min(window.innerHeight - 38, rect.top - 15))}px`;
      pin.addEventListener("click", () => {
        if (annotation.status === "success" && annotation.issue?.url)
          window.open(annotation.issue.url, "_blank", "noopener");
        else openNote(annotation.element, annotation);
      });
      pins.appendChild(pin);
    });
  }

  function renderSession() {
    const flowEvidenceCount = reproductionSteps.length || diagnostics.length;
    const reviewCount = annotations.length || flowEvidenceCount;
    layer.querySelector("[data-count]").textContent = annotations.length;
    reviewButton.querySelector("span").textContent = annotations.length
      ? "Review issues"
      : "Review flow";
    reviewButton.querySelector("b").textContent = reviewCount;
    reviewButton.disabled = !reviewCount && !flowIssue;
    recordButton.querySelector("b").textContent = reproductionSteps.length;
    layer.querySelector("[data-diagnostic-count]").textContent =
      diagnostics.length;
    layer.querySelector("[data-network-count]").textContent =
      networkRequests.length;
    layer.querySelector("[data-step-count]").textContent =
      reproductionSteps.length;
    updatePins();
    renderDeveloperState();
    if (panel.classList.contains("visible")) renderReviewPanel();
  }

  function getSharedRouting() {
    return {
      teamId: panel.querySelector('[data-route="team"]').value,
      priority: Number(panel.querySelector('[data-route="priority"]').value),
      assigneeId: panel.querySelector('[data-route="assignee"]').value,
      projectId: panel.querySelector('[data-route="project"]').value,
      labelIds: [
        ...panel.querySelectorAll(".doppie-label-options input:checked"),
      ].map((input) => input.value),
    };
  }

  function optionMarkup(items, selectedId, emptyLabel = "") {
    const emptyOption = emptyLabel
      ? `<option value="">${escapeMarkup(emptyLabel)}</option>`
      : "";
    return `${emptyOption}${items
      .map((item) => {
        const label = item.displayName || item.name;
        return `<option value="${escapeMarkup(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeMarkup(label)}</option>`;
      })
      .join("")}`;
  }

  function feedbackTypeOptions(selected) {
    return Object.entries(DoppieIssueFormat.FEEDBACK_TYPES)
      .map(
        ([value, item]) =>
          `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeMarkup(item.label)}</option>`,
      )
      .join("");
  }

  function openReviewEditor(id) {
    const annotation = getAnnotation(id);
    if (!annotation || ["creating", "success"].includes(annotation.status))
      return;
    reviewEditingId = id;
    renderReviewPanel();
    panel
      .querySelector('[data-item-field="title"]')
      ?.focus({ preventScroll: true });
  }

  function renderReviewPanel() {
    const list = panel.querySelector(".doppie-review-list");
    list.classList.toggle("flow-only", annotations.length === 0);
    panel.classList.toggle("editing-item", Boolean(reviewEditingId));
    panel.querySelector("header strong").textContent = annotations.length
      ? "Ready for Linear"
      : "Recorded flow ready";
    panel.querySelector('[data-review-option="parent"]').checked = parentMode;
    panel.querySelector('[data-review-option="parent"]').disabled =
      Boolean(parentIssue);
    const parentOption = panel.querySelector(".doppie-review-options > label");
    parentOption.hidden = annotations.length === 0;
    parentOption.querySelector("small").textContent = parentIssue?.identifier
      ? `${parentIssue.identifier} created as review parent`
      : "One review summary with child issues";
    const contextPreview = panel.querySelector(".doppie-context-preview");
    contextPreview.hidden =
      !sessionVideo &&
      !reproductionSteps.length &&
      !networkRequests.length &&
      !sessionEvents.length &&
      !diagnostics.length;
    const videoContext = contextPreview.querySelector("[data-context-video]");
    videoContext.hidden = !sessionVideo;
    if (sessionVideo) {
      const video = videoContext.querySelector("video");
      if (video.src !== sessionVideo.dataUrl) video.src = sessionVideo.dataUrl;
      videoContext.querySelector("small").textContent = `${Math.max(
        1,
        Math.round((sessionVideo.durationMs || 0) / 1000),
      )}s · ${Math.max(1, Math.round((sessionVideo.size || 0) / 1024))} KB · video only`;
    }
    contextPreview.querySelector("[data-context-steps]").innerHTML =
      reproductionSteps.length
        ? reproductionSteps
            .slice(-10)
            .map((step) => `<li>${escapeMarkup(step.action)}</li>`)
            .join("")
        : "<li>No recorded steps</li>";
    contextPreview.querySelector("[data-context-network]").innerHTML =
      networkRequests.length
        ? networkRequests
            .slice(-8)
            .map(
              (item) =>
                `<li><b>${escapeMarkup(`${item.method || "GET"} ${item.status ?? "pending"}`)}</b> ${escapeMarkup(item.url)}</li>`,
            )
            .join("")
        : "<li>No captured requests</li>";
    contextPreview.querySelector("[data-context-events]").innerHTML =
      sessionEvents.length
        ? sessionEvents
            .slice(-8)
            .map(
              (item) =>
                `<li><b>${escapeMarkup(item.type)}</b> ${escapeMarkup(item.message)}</li>`,
            )
            .join("")
        : "<li>No captured events</li>";
    contextPreview.querySelector("[data-context-diagnostics]").innerHTML =
      diagnostics.length
        ? diagnostics
            .slice(-8)
            .map(
              (item) =>
                `<li><b>${escapeMarkup(item.type)}</b> ${escapeMarkup(item.message)}</li>`,
            )
            .join("")
        : "<li>No captured diagnostics</li>";
    list.innerHTML = "";
    if (!annotations.length) {
      const locked = Boolean(flowIssue);
      list.innerHTML = `
        <section class="doppie-flow-composer ${locked ? "success" : ""}">
          <div class="doppie-flow-composer-heading"><span>${doppieUiIcon("record")}</span><div><strong>${locked ? escapeMarkup(flowIssue.identifier) : "Reproduction issue"}</strong><small>${reproductionSteps.length} ${reproductionSteps.length === 1 ? "step" : "steps"} · ${diagnostics.length} diagnostics</small></div></div>
          <label><span class="doppie-field-label">${doppieUiIcon("issue")}Issue title</span><input data-flow-field="title" maxlength="120" value="${escapeMarkup(flowDraft.title)}" ${locked ? "disabled" : ""}></label>
          <label><span class="doppie-field-label">${doppieUiIcon("template")}Feedback type</span><select data-flow-field="type" ${locked ? "disabled" : ""}>${feedbackTypeOptions(flowDraft.feedbackType)}</select></label>
          <label class="doppie-flow-request"><span class="doppie-field-label">${doppieUiIcon("request")}Summary</span><textarea data-flow-field="request" rows="3" maxlength="1200" ${locked ? "disabled" : ""}>${escapeMarkup(flowDraft.request)}</textarea></label>
        </section>`;
      list.querySelectorAll("[data-flow-field]").forEach((field) =>
        field.addEventListener("input", () => {
          flowDraft.title = list.querySelector(
            '[data-flow-field="title"]',
          ).value;
          flowDraft.feedbackType = list.querySelector(
            '[data-flow-field="type"]',
          ).value;
          flowDraft.request = list.querySelector(
            '[data-flow-field="request"]',
          ).value;
          persistSession();
        }),
      );
    }
    annotations.forEach((annotation, index) => {
      const row = document.createElement("article");
      row.className = `doppie-review-item ${annotation.status || ""}`;
      const status = annotation.issue
        ? escapeMarkup(annotation.issue.identifier)
        : annotation.status === "creating"
          ? "Creating..."
          : annotation.status === "failed"
            ? escapeMarkup(annotation.error || "Failed")
            : `${escapeMarkup(DoppieIssueFormat.FEEDBACK_TYPES[annotation.feedbackType]?.label || "UI change")} · ${escapeMarkup(annotation.label)}${annotation.routing ? " · Custom routing" : ""}`;
      const locked = ["creating", "success"].includes(annotation.status);
      const evidence = annotation.screenshot
        ? `<img src="${annotation.screenshot}" alt="Screenshot of ${escapeMarkup(annotation.label)}">`
        : `<span class="doppie-review-no-image">${doppieUiIcon("imageOff")}</span>`;
      row.innerHTML = `<button type="button" class="doppie-review-thumb" data-locate-id="${annotation.id}" aria-label="Locate ${escapeMarkup(annotation.label)}" title="Locate element on page">${evidence}<span>${index + 1}</span></button><button type="button" class="doppie-item-summary" data-edit-id="${annotation.id}"><strong>${escapeMarkup(annotation.title)}</strong><small>${status} · ${escapeMarkup(annotation.screenshotMode || "element")} evidence</small></button><button type="button" class="doppie-item-edit" data-edit-id="${annotation.id}" aria-label="Edit issue" title="Edit issue" ${locked ? "hidden" : ""}>${doppieUiIcon("edit")}</button><button type="button" class="doppie-item-delete" data-delete-id="${annotation.id}" aria-label="Remove annotation" title="Remove annotation" ${locked ? "hidden" : ""}>×</button>`;
      list.appendChild(row);

      if (reviewEditingId !== annotation.id || locked) return;
      const routing = annotation.routing || getSharedRouting();
      const usesDefaults = !annotation.routing;
      const labels = (linearConfig?.labels || [])
        .map(
          (item) =>
            `<label><input type="checkbox" value="${escapeMarkup(item.id)}" ${routing.labelIds.includes(item.id) ? "checked" : ""} ${usesDefaults ? "disabled" : ""}><i style="background:${/^#[0-9a-f]{6}$/i.test(item.color || "") ? item.color : "#8a918b"}"></i><span>${escapeMarkup(item.name)}</span></label>`,
        )
        .join("");
      const editor = document.createElement("section");
      editor.className = "doppie-item-editor";
      editor.dataset.itemEditor = annotation.id;
      editor.innerHTML = `
        <label class="doppie-item-field doppie-item-field-wide">
          <span class="doppie-field-label">${doppieUiIcon("issue")}Issue title</span>
          <input data-item-field="title" maxlength="120" value="${escapeMarkup(annotation.title)}">
        </label>
        <label class="doppie-item-field doppie-item-field-wide">
          <span class="doppie-field-label">${doppieUiIcon("template")}Feedback type</span>
          <select data-item-field="type">${feedbackTypeOptions(annotation.feedbackType || "ui")}</select>
        </label>
        <label class="doppie-item-field doppie-item-field-wide">
          <span class="doppie-field-label">${doppieUiIcon("crop")}Screenshot evidence</span>
          <select data-item-field="screenshot"><option value="element" ${annotation.screenshotMode !== "viewport" && annotation.screenshotMode !== "none" ? "selected" : ""}>Element crop</option><option value="viewport" ${annotation.screenshotMode === "viewport" ? "selected" : ""}>Viewport with marker</option><option value="none" ${annotation.screenshotMode === "none" ? "selected" : ""}>No screenshot</option></select>
        </label>
        <label class="doppie-item-field doppie-item-field-wide">
          <span class="doppie-field-label">${doppieUiIcon("request")}Request</span>
          <textarea data-item-field="note" rows="3" maxlength="1200">${escapeMarkup(annotation.note)}</textarea>
        </label>
        <label class="doppie-use-defaults"><input type="checkbox" data-item-field="defaults" ${usesDefaults ? "checked" : ""}><span>Use review defaults</span></label>
        <div class="doppie-item-routing ${usesDefaults ? "disabled" : ""}">
          <label><span class="doppie-field-label">${doppieUiIcon("team")}Team</span><select data-item-route="team" ${usesDefaults ? "disabled" : ""}>${optionMarkup(linearConfig?.teams || [], routing.teamId)}</select></label>
          <label><span class="doppie-field-label">${doppieUiIcon("priority")}Priority</span><select data-item-route="priority" ${usesDefaults ? "disabled" : ""}><option value="3" ${routing.priority === 3 ? "selected" : ""}>Normal</option><option value="2" ${routing.priority === 2 ? "selected" : ""}>High</option><option value="1" ${routing.priority === 1 ? "selected" : ""}>Urgent</option><option value="4" ${routing.priority === 4 ? "selected" : ""}>Low</option></select></label>
          <label><span class="doppie-field-label">${doppieUiIcon("assignee")}Assignee</span><select data-item-route="assignee" ${usesDefaults ? "disabled" : ""}>${optionMarkup(linearConfig?.users || [], routing.assigneeId, "No assignee")}</select></label>
          <label><span class="doppie-field-label">${doppieUiIcon("project")}Project</span><select data-item-route="project" ${usesDefaults ? "disabled" : ""}>${optionMarkup(linearConfig?.projects || [], routing.projectId, "No project")}</select></label>
          <fieldset><legend class="doppie-field-label">${doppieUiIcon("labels")}Labels</legend><div class="doppie-item-labels">${labels}</div></fieldset>
        </div>
        <p class="doppie-item-error" role="alert"></p>
        <footer><button type="button" data-item-action="cancel">Cancel</button><button type="button" class="doppie-item-save" data-item-action="save">Save issue</button></footer>`;
      list.appendChild(editor);
    });
    list.querySelectorAll("[data-edit-id]").forEach((button) =>
      button.addEventListener("click", () => {
        const annotation = getAnnotation(button.dataset.editId);
        if (annotation?.status === "success" && annotation.issue?.url) {
          window.open(annotation.issue.url, "_blank", "noopener");
          return;
        }
        openReviewEditor(button.dataset.editId);
      }),
    );
    list.querySelectorAll("[data-locate-id]").forEach((button) =>
      button.addEventListener("click", () => locateAnnotation(button.dataset.locateId)),
    );
    list.querySelectorAll("[data-delete-id]").forEach((button) =>
      button.addEventListener("click", () => {
        const index = annotations.findIndex(
          (annotation) => annotation.id === button.dataset.deleteId,
        );
        if (index >= 0) annotations.splice(index, 1);
        if (reviewEditingId === button.dataset.deleteId) reviewEditingId = null;
        renderSession();
        persistSession(true);
      }),
    );
    const editor = list.querySelector(".doppie-item-editor");
    if (editor) {
      const defaults = editor.querySelector('[data-item-field="defaults"]');
      defaults.addEventListener("change", () => {
        const routing = editor.querySelector(".doppie-item-routing");
        routing.classList.toggle("disabled", defaults.checked);
        routing
          .querySelectorAll("select, input")
          .forEach((input) => (input.disabled = defaults.checked));
      });
      editor
        .querySelector('[data-item-action="cancel"]')
        .addEventListener("click", () => {
          reviewEditingId = null;
          renderReviewPanel();
        });
      editor
        .querySelector('[data-item-action="save"]')
        .addEventListener("click", async () => {
          const annotation = getAnnotation(editor.dataset.itemEditor);
          const title = editor
            .querySelector('[data-item-field="title"]')
            .value.trim();
          const note = editor
            .querySelector('[data-item-field="note"]')
            .value.trim();
          const error = editor.querySelector(".doppie-item-error");
          if (!title || !note) {
            error.textContent = "Add both an issue title and request.";
            editor
              .querySelector(
                !title
                  ? '[data-item-field="title"]'
                  : '[data-item-field="note"]',
              )
              .focus();
            return;
          }
          const screenshotMode = editor.querySelector(
            '[data-item-field="screenshot"]',
          ).value;
          if (screenshotMode !== annotation.screenshotMode) {
            const element = resolveAnnotationElement(annotation);
            if (!element && screenshotMode !== "none") {
              error.textContent = "The target is no longer available to recapture.";
              return;
            }
            const saveButton = editor.querySelector('[data-item-action="save"]');
            saveButton.disabled = true;
            saveButton.textContent = "Recapturing...";
            try {
              const crop = await captureAnnotation(
                element,
                screenshotMode,
                annotations.indexOf(annotation) + 1,
              );
              annotation.screenshot = crop.dataUrl;
              annotation.width = crop.width;
              annotation.height = crop.height;
              annotation.screenshotMode = screenshotMode;
            } catch (captureError) {
              error.textContent = captureError.message || "Could not recapture evidence.";
              saveButton.disabled = false;
              saveButton.textContent = "Save issue";
              return;
            }
          }
          let routing = null;
          if (!defaults.checked) {
            routing = {
              teamId: editor.querySelector('[data-item-route="team"]').value,
              priority: Number(
                editor.querySelector('[data-item-route="priority"]').value,
              ),
              assigneeId: editor.querySelector('[data-item-route="assignee"]')
                .value,
              projectId: editor.querySelector('[data-item-route="project"]')
                .value,
              labelIds: [
                ...editor.querySelectorAll(".doppie-item-labels input:checked"),
              ].map((input) => input.value),
            };
            if (!routing.teamId) {
              error.textContent = "Choose a Linear team for this issue.";
              return;
            }
          }
          Object.assign(annotation, {
            title,
            note,
            feedbackType: editor.querySelector('[data-item-field="type"]')
              .value,
            routing,
            status:
              annotation.status === "failed" ? "pending" : annotation.status,
            issue: annotation.status === "failed" ? null : annotation.issue,
            error: "",
          });
          reviewEditingId = null;
          panelMessage.textContent = "Issue changes saved.";
          renderSession();
          persistSession(true);
        });
    }
    const failed = annotations.filter(
      (annotation) => annotation.status === "failed",
    ).length;
    const complete = annotations.filter(
      (annotation) => annotation.status === "success",
    ).length;
    if (!annotations.length && flowIssue) {
      submitButton.textContent = "Done";
    } else if (!annotations.length) {
      submitButton.textContent = "Create recorded flow issue";
    } else if (complete === annotations.length && annotations.length) {
      submitButton.textContent = "Done";
    } else if (failed) {
      submitButton.textContent = `Retry ${failed} failed ${failed === 1 ? "issue" : "issues"}`;
    } else {
      submitButton.textContent = parentMode
        ? `Create parent + ${annotations.length} ${annotations.length === 1 ? "issue" : "issues"}`
        : `Create ${annotations.length} Linear ${annotations.length === 1 ? "issue" : "issues"}`;
    }
  }

  function populateRouting() {
    const team = panel.querySelector('[data-route="team"]');
    const assignee = panel.querySelector('[data-route="assignee"]');
    const project = panel.querySelector('[data-route="project"]');
    team.innerHTML = (linearConfig?.teams || [])
      .map(
        (item) =>
          `<option value="${item.id}">${escapeMarkup(item.name)}</option>`,
      )
      .join("");
    assignee.innerHTML = [
      '<option value="">No assignee</option>',
      ...(linearConfig?.users || []).map(
        (item) =>
          `<option value="${item.id}">${escapeMarkup(item.displayName || item.name)}</option>`,
      ),
    ].join("");
    project.innerHTML = [
      '<option value="">No project</option>',
      ...(linearConfig?.projects || []).map(
        (item) =>
          `<option value="${item.id}">${escapeMarkup(item.name)}</option>`,
      ),
    ].join("");
    panel.querySelector(".doppie-label-options").innerHTML = (
      linearConfig?.labels || []
    )
      .map(
        (item) =>
          `<label><input type="checkbox" value="${item.id}"><i style="background:${/^#[0-9a-f]{6}$/i.test(item.color || "") ? item.color : "#8a918b"}"></i><span>${escapeMarkup(item.name)}</span></label>`,
      )
      .join("");
    if (sharedRoutingDraft) {
      if (
        [...team.options].some(
          (option) => option.value === sharedRoutingDraft.teamId,
        )
      )
        team.value = sharedRoutingDraft.teamId;
      panel.querySelector('[data-route="priority"]').value = String(
        sharedRoutingDraft.priority || 3,
      );
      assignee.value = sharedRoutingDraft.assigneeId || "";
      project.value = sharedRoutingDraft.projectId || "";
      panel
        .querySelectorAll(".doppie-label-options input")
        .forEach(
          (input) =>
            (input.checked = sharedRoutingDraft.labelIds?.includes(
              input.value,
            )),
        );
    }
    panel
      .querySelectorAll(
        '.doppie-routing select, .doppie-label-options input[type="checkbox"]',
      )
      .forEach((input) =>
        input.addEventListener("change", () => {
          sharedRoutingDraft = getSharedRouting();
          persistSession();
        }),
      );
    if (!linearConnected) {
      panelMessage.textContent =
        "Connect Linear from Doppie Assist before submitting.";
      submitButton.disabled = true;
    }
  }

  async function captureAnnotation(element, mode = "element", markerNumber = 1) {
    if (mode === "none") return { dataUrl: "", width: 0, height: 0 };
    const bounds = element.getBoundingClientRect();
    const padding = mode === "element" ? 20 : 0;
    const rect =
      mode === "viewport"
        ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
        : {
            x: bounds.left - padding,
            y: bounds.top - padding,
            width: bounds.width + padding * 2,
            height: bounds.height + padding * 2,
          };
    layer.style.visibility = "hidden";
    await nextPaint();
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "capture-visible-tab",
      });
    } finally {
      layer.style.visibility = "";
    }
    if (!response?.ok) throw new Error(response?.error || "Capture failed");
    if (mode === "viewport")
      return markViewportScreenshot(response.dataUrl, bounds, markerNumber);
    return cropScreenshot(response.dataUrl, rect);
  }

  async function saveNote() {
    const note = noteText.value.trim();
    if (!note) {
      noteError.textContent = "Describe the change before adding it.";
      noteText.focus();
      return;
    }
    if (!target?.isConnected) {
      noteError.textContent = "This element is no longer on the page.";
      return;
    }
    const button = popover.querySelector('[data-note-action="save"]');
    const buttonLabel = button.querySelector("span");
    const idleText = buttonLabel.textContent;
    const selectedElement = target;
    const developerContext = DoppieDevContext.capture(selectedElement);
    const screenshotMode =
      popover.querySelector("[data-capture-mode].active")?.dataset.captureMode ||
      "element";
    button.disabled = true;
    buttonLabel.textContent = "Capturing...";
    noteError.textContent = "";
    try {
      const existing = editingId ? getAnnotation(editingId) : null;
      const markerNumber = existing
        ? annotations.indexOf(existing) + 1
        : annotations.length + 1;
      const crop = await captureAnnotation(
        selectedElement,
        screenshotMode,
        markerNumber,
      );
      const title = note.split("\n")[0].trim().slice(0, 120);
      defaultFeedbackType = noteType.value;
      const data = {
        note,
        title,
        feedbackType: noteType.value,
        label: describeElement(selectedElement),
        selector: developerContext.selector.primary,
        elementText: developerContext.element.text,
        elementHtml: developerContext.element.html,
        tagName: developerContext.element.tag,
        bounds: developerContext.bounds,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
          scrollX: Math.round(window.scrollX),
          scrollY: Math.round(window.scrollY),
        },
        developerContext,
        screenshotMode,
        screenshot: crop.dataUrl,
        width: crop.width,
        height: crop.height,
        pageTitle: document.title,
        pageUrl: location.href,
        element: selectedElement,
        status: "pending",
        issue: null,
        error: "",
      };
      if (existing) Object.assign(existing, data);
      else annotations.push({ id: crypto.randomUUID(), ...data });
      closeNote();
      renderSession();
      await persistSession(true);
      showPageToast(
        `${existing ? "Annotation updated" : `Annotation ${annotations.length} added`}. Select another element or review issues.`,
      );
    } catch (error) {
      noteError.textContent =
        error.message || "Could not capture this element.";
    } finally {
      button.disabled = false;
      buttonLabel.textContent = idleText;
    }
  }

  async function createIssues() {
    if (!annotations.length && flowIssue) {
      await copyIssueLinks();
      await clearSavedSession();
      cleanup({ discard: true, silent: true });
      return;
    }
    if (
      annotations.length &&
      annotations.every((annotation) => annotation.status === "success")
    ) {
      await copyIssueLinks();
      await clearSavedSession();
      cleanup({ discard: true, silent: true });
      return;
    }
    if (!linearConnected) {
      panelMessage.textContent =
        "Connect Linear from Doppie Assist before submitting.";
      return;
    }
    const sharedRouting = getSharedRouting();
    if (!annotations.length) {
      const title = flowDraft.title.trim();
      const request = flowDraft.request.trim();
      if (!title || !request || !sharedRouting.teamId) {
        panelMessage.textContent = !sharedRouting.teamId
          ? "Choose a Linear team for this recorded flow."
          : "Add both an issue title and summary.";
        return;
      }
      submitButton.disabled = true;
      panelMessage.textContent = "Creating recorded flow issue...";
      const input = {
        title,
        teamId: sharedRouting.teamId,
        priority: sharedRouting.priority,
        description: DoppieIssueFormat.buildIssueDescription({
          issueTitle: title,
          request,
          pageTitle: reproductionSteps[0]?.pageTitle || document.title,
          url: reproductionSteps[0]?.url || location.href,
          feedbackType: flowDraft.feedbackType,
          mode: "flow",
          label: "Recorded reproduction flow",
          reproductionSteps,
          diagnostics,
          networkRequests,
          sessionEvents,
          sessionVideo,
        }),
      };
      if (sharedRouting.assigneeId) input.assigneeId = sharedRouting.assigneeId;
      if (sharedRouting.projectId) input.projectId = sharedRouting.projectId;
      if (sharedRouting.labelIds.length)
        input.labelIds = sharedRouting.labelIds;
      const screenshots = reproductionSteps
        .filter((step) => step.screenshot)
        .slice(0, 6)
        .map((step, index) => ({
          dataUrl: step.screenshot,
          filename: `doppie-step-${index + 1}.jpg`,
          alt: `Reproduction step ${index + 1}`,
        }));
      try {
        const response = await chrome.runtime.sendMessage({
          type: "create-linear-issue",
          input,
          screenshots,
          video: sessionVideo
            ? {
                dataUrl: sessionVideo.dataUrl,
                filename: `doppie-flow-${sessionId}.webm`,
              }
            : undefined,
        });
        if (!response?.ok)
          throw new Error(response?.error || "Linear request failed");
        flowIssue = response.issue;
        await saveCreatedIssue({
          title,
          note: request,
          screenshot: screenshots[0]?.dataUrl || "",
          issue: flowIssue,
        });
        const copied = await copyIssueLinks();
        panelMessage.textContent = `${flowIssue.identifier} created in Linear${copied ? ". Link copied." : "."}`;
        await persistSession(true);
      } catch (error) {
        panelMessage.textContent =
          error.message || "Could not create the recorded flow issue.";
      } finally {
        submitButton.disabled = false;
        renderSession();
      }
      return;
    }
    const pending = annotations.filter(
      (annotation) => annotation.status !== "success",
    );
    reviewEditingId = null;
    submitButton.disabled = true;
    let reproductionEvidenceAttached = annotations.some(
      (annotation) => annotation.status === "success",
    );

    if (parentMode && !parentIssue) {
      if (!sharedRouting.teamId) {
        panelMessage.textContent = "Choose a Linear team for the parent issue.";
        submitButton.disabled = false;
        return;
      }
      panelMessage.textContent = "Creating the parent review issue...";
      const parentInput = {
        title: `Page review: ${annotations[0]?.pageTitle || document.title}`,
        teamId: sharedRouting.teamId,
        priority: sharedRouting.priority,
        description: DoppieIssueFormat.buildReviewDescription({
          title: `Page review: ${annotations[0]?.pageTitle || document.title}`,
          pageTitle: annotations[0]?.pageTitle || document.title,
          url: annotations[0]?.pageUrl || location.href,
          annotations,
          reproductionSteps,
          diagnostics,
          networkRequests,
          sessionEvents,
          sessionVideo,
        }),
      };
      if (sharedRouting.assigneeId)
        parentInput.assigneeId = sharedRouting.assigneeId;
      if (sharedRouting.projectId)
        parentInput.projectId = sharedRouting.projectId;
      if (sharedRouting.labelIds.length)
        parentInput.labelIds = sharedRouting.labelIds;
      const screenshots = reproductionSteps
        .filter((step) => step.screenshot)
        .slice(0, 6)
        .map((step, index) => ({
          dataUrl: step.screenshot,
          filename: `doppie-step-${index + 1}.jpg`,
          alt: `Reproduction step ${index + 1}`,
        }));
      try {
        const response = await chrome.runtime.sendMessage({
          type: "create-linear-issue",
          input: parentInput,
          screenshots,
          video: sessionVideo
            ? {
                dataUrl: sessionVideo.dataUrl,
                filename: `doppie-flow-${sessionId}.webm`,
              }
            : undefined,
        });
        if (!response?.ok)
          throw new Error(response?.error || "Could not create parent issue");
        parentIssue = response.issue;
        await saveCreatedIssue({
          title: parentInput.title,
          note: `Parent for ${annotations.length} page review issues`,
          screenshot: screenshots[0]?.dataUrl || "",
          issue: parentIssue,
        });
        await copyIssueLinks();
        reproductionEvidenceAttached = true;
        await persistSession(true);
      } catch (error) {
        panelMessage.textContent =
          error.message || "Could not create the parent review issue.";
        submitButton.disabled = false;
        renderSession();
        return;
      }
    }

    for (let index = 0; index < pending.length; index += 1) {
      const annotation = pending[index];
      const routing = annotation.routing || sharedRouting;
      if (
        !annotation.title.trim() ||
        !annotation.note.trim() ||
        !routing.teamId
      ) {
        annotation.status = "failed";
        annotation.error = !routing.teamId
          ? "Choose a team for this issue"
          : "Add an issue title and request";
        renderSession();
        continue;
      }
      annotation.status = "creating";
      annotation.error = "";
      panelMessage.textContent = `Creating issue ${index + 1} of ${pending.length}...`;
      renderSession();
      const input = {
        title: annotation.title,
        teamId: routing.teamId,
        priority: routing.priority,
        description: buildAnnotationDescription(annotation),
      };
      if (routing.assigneeId) input.assigneeId = routing.assigneeId;
      if (routing.projectId) input.projectId = routing.projectId;
      if (routing.labelIds.length) input.labelIds = routing.labelIds;
      if (parentIssue?.id) input.parentId = parentIssue.id;
      const attachSharedEvidence = !parentMode && !reproductionEvidenceAttached;
      const screenshots =
        attachSharedEvidence
          ? reproductionSteps
              .filter((step) => step.screenshot)
              .slice(0, 6)
              .map((step, stepIndex) => ({
                dataUrl: step.screenshot,
                filename: `doppie-step-${stepIndex + 1}.jpg`,
                alt: `Reproduction step ${stepIndex + 1}`,
              }))
          : [];
      try {
        const response = await chrome.runtime.sendMessage({
          type: "create-linear-issue",
          input,
          screenshot: annotation.screenshot,
          screenshotName: `doppie-element-${index + 1}.jpg`,
          screenshots,
          video:
            attachSharedEvidence && sessionVideo
              ? {
                  dataUrl: sessionVideo.dataUrl,
                  filename: `doppie-flow-${sessionId}.webm`,
                }
              : undefined,
        });
        if (!response?.ok)
          throw new Error(response?.error || "Linear request failed");
        annotation.status = "success";
        annotation.issue = response.issue;
        reproductionEvidenceAttached = true;
        await saveCreatedIssue(annotation);
        await copyIssueLinks();
      } catch (error) {
        annotation.status = "failed";
        annotation.error = error.message || "Could not create issue";
      }
      await persistSession(true);
      renderSession();
    }

    const failures = annotations.filter(
      (annotation) => annotation.status === "failed",
    ).length;
    const copied = await copyIssueLinks();
    panelMessage.textContent = failures
      ? `${failures} ${failures === 1 ? "issue needs" : "issues need"} another try. Created links copied.`
      : `${annotations.length} ${annotations.length === 1 ? "issue" : "issues"} created in Linear${copied ? ". Links copied." : "."}`;
    submitButton.disabled = false;
    renderSession();
  }

  function buildAnnotationDescription(annotation) {
    return DoppieIssueFormat.buildIssueDescription({
      issueTitle: annotation.title,
      request: annotation.note,
      pageTitle: annotation.pageTitle || document.title,
      url: annotation.pageUrl || location.href,
      feedbackType: annotation.feedbackType || "ui",
      mode: "element",
      label: annotation.label,
      selector: annotation.selector,
      tagName: annotation.tagName,
      elementText: annotation.elementText,
      elementHtml: annotation.elementHtml,
      bounds: annotation.bounds,
      viewport: annotation.viewport,
      developerContext: annotation.developerContext,
      screenshotMode: annotation.screenshotMode || "element",
      captureWidth: annotation.width,
      captureHeight: annotation.height,
      reproductionSteps,
      diagnostics,
      networkRequests,
      sessionEvents,
      sessionVideo,
    });
  }

  function resolveAnnotationElement(annotation) {
    if (annotation.element?.isConnected) return annotation.element;
    const element = DoppieDevContext.resolve(annotation.developerContext) ||
      DoppieDevContext.resolve({
        selector: { primary: annotation.selector, alternatives: [] },
      });
    if (element) annotation.element = element;
    return element;
  }

  function locateAnnotation(id) {
    const annotation = getAnnotation(id);
    const element = annotation && resolveAnnotationElement(annotation);
    if (!element) {
      panelMessage.textContent =
        "Target not found. The page may have changed since this annotation was captured.";
      return;
    }
    closePanel();
    element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    window.setTimeout(() => openNote(element, annotation), 280);
  }

  function buildAgentBundle() {
    return {
      schema: "doppie-assist/handoff-v1",
      sessionId,
      capturedAt: new Date().toISOString(),
      page: {
        title: document.title,
        url: location.href,
        path: `${location.pathname}${location.search}${location.hash}`,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
        },
      },
      developerContext: "automatic",
      annotations: annotations.map((annotation) => ({
        id: annotation.id,
        title: annotation.title,
        request: annotation.note,
        feedbackType: annotation.feedbackType,
        label: annotation.label,
        selector:
          annotation.developerContext?.selector?.primary || annotation.selector,
        screenshotMode: annotation.screenshotMode || "element",
        screenshot: annotation.screenshot || "",
        developerContext: annotation.developerContext,
        issueDescription: buildAnnotationDescription(annotation),
      })),
      reproductionSteps,
      diagnostics,
      networkRequests,
      sessionEvents,
      sessionVideo,
    };
  }

  async function sendToAgent() {
    if (!annotations.length && !reproductionSteps.length) {
      panelMessage.textContent =
        "Add an annotation or record a flow before sending to an agent.";
      return;
    }
    if (!devBridgeConnected) {
      panelMessage.textContent =
        "Run $doppie-assist in Codex, then keep this review open.";
      return;
    }
    sendAgentButton.disabled = true;
    sendAgentButton.querySelector("span").textContent = "Sending review...";
    panelMessage.textContent = "Sending developer context to the waiting agent...";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "dev-bridge-submit",
        bundle: buildAgentBundle(),
      });
      if (!response?.ok)
        throw new Error(response?.error || "The agent did not accept this review");
      agentHandoff = {
        sentAt: Date.now(),
        directory: response.directory,
      };
      panelMessage.textContent =
        "Review sent. The coding agent now has the screenshots and element context.";
      await persistSession(true);
    } catch (error) {
      agentHandoff = null;
      panelMessage.textContent =
        error.message || "Could not send this review to the coding agent.";
      await refreshDevBridgeStatus();
    } finally {
      renderDeveloperState();
    }
  }

  async function saveCreatedIssue(annotation) {
    const { issues = [] } = await chrome.storage.local.get("issues");
    issues.unshift({
      title: annotation.title,
      description: annotation.note,
      capture: annotation.screenshot,
      identifier: annotation.issue.identifier,
      url: annotation.issue.url,
      createdAt: new Date().toLocaleDateString(),
    });
    await chrome.storage.local.set({ issues: issues.slice(0, 30) });
  }

  function removeEditingAnnotation() {
    const index = annotations.findIndex(
      (annotation) => annotation.id === editingId,
    );
    if (index >= 0) annotations.splice(index, 1);
    closeNote();
    renderSession();
    persistSession(true);
  }

  function openPanel() {
    closeNote();
    hoverBox.classList.remove("visible");
    document.querySelector(".margin-toast")?.remove();
    layer.classList.add("panel-open");
    panel.classList.add("visible");
    renderReviewPanel();
  }

  function closePanel() {
    reviewEditingId = null;
    layer.classList.remove("panel-open");
    panel.classList.remove("visible", "editing-item");
  }

  function cleanup({ discard = false, silent = false } = {}) {
    if (videoActive) {
      videoActive = false;
      recording = false;
      chrome.runtime
        .sendMessage({ type: "stop-flow-video", sessionId })
        .catch(() => {});
    }
    if (discard) clearSavedSession();
    else persistSession(true);
    layer.remove();
    document.documentElement.classList.remove("doppie-reviewing");
    document.documentElement.classList.remove("doppie-recording");
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("click", onPageClick, true);
    document.removeEventListener("click", onRecordedClick, true);
    document.removeEventListener("change", onRecordedChange, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("scroll", queueRefresh, true);
    window.removeEventListener("resize", queueRefresh);
    window.removeEventListener("beforeunload", onBeforeUnload);
    window.removeEventListener("doppie-assist:diagnostic", onDiagnosticEvent);
    clearInterval(bridgeCheckTimer);
    window.dispatchEvent(
      new CustomEvent("doppie-assist:monitor-control", { detail: "stop" }),
    );
    activeReviewSession = null;
    if (!discard && !silent)
      showPageToast("Review saved. Reopen Doppie Assist to continue.");
  }

  function onBeforeUnload() {
    persistSession(true);
  }

  function onPointerMove(event) {
    if (
      recording ||
      isReviewUi(event.target) ||
      popover.classList.contains("visible") ||
      panel.classList.contains("visible")
    )
      return;
    const candidate = event.target;
    if (!(candidate instanceof Element)) return;
    if (candidate !== hoverOrigin) setTargetElement(candidate);
    else updateHoverBox();
  }

  function onWheel(event) {
    if (
      !event.altKey ||
      recording ||
      panel.classList.contains("visible") ||
      isReviewUi(event.target) ||
      !targetStack.length
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cycleTarget(event.deltaY >= 0 ? 1 : -1);
  }

  function onPageClick(event) {
    if (recording) return;
    if (isReviewUi(event.target) || event.button !== 0) return;
    if (popover.classList.contains("visible")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      noteText.focus({ preventScroll: true });
      return;
    }
    const candidate = event.target;
    if (!(candidate instanceof Element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closePanel();
    const existing = annotations.find(
      (annotation) => annotation.element === candidate,
    );
    openNote(candidate, existing);
  }

  function onKeyDown(event) {
    if (event.key !== "Escape") return;
    if (recording) setRecording(false);
    else if (popover.classList.contains("visible")) closeNote();
    else if (reviewEditingId) {
      reviewEditingId = null;
      renderReviewPanel();
    } else if (panel.classList.contains("visible")) closePanel();
    else cleanup();
  }

  layer
    .querySelector('[data-note-action="close"]')
    .addEventListener("click", closeNote);
  layer
    .querySelector('[data-note-action="cancel"]')
    .addEventListener("click", closeNote);
  layer
    .querySelector('[data-note-action="child"]')
    .addEventListener("click", () => cycleTarget(-1));
  layer
    .querySelector('[data-note-action="parent"]')
    .addEventListener("click", () => cycleTarget(1));
  layer.querySelectorAll("[data-capture-mode]").forEach((button) =>
    button.addEventListener("click", () => {
      layer
        .querySelectorAll("[data-capture-mode]")
        .forEach((item) => item.classList.toggle("active", item === button));
    }),
  );
  layer
    .querySelector('[data-note-action="save"]')
    .addEventListener("click", saveNote);
  layer
    .querySelector('[data-note-action="remove"]')
    .addEventListener("click", removeEditingAnnotation);
  layer
    .querySelector('[data-panel-action="close"]')
    .addEventListener("click", closePanel);
  submitButton.addEventListener("click", createIssues);
  sendAgentButton.addEventListener("click", sendToAgent);
  layer
    .querySelector('[data-session-action="cancel"]')
    .addEventListener("click", () => cleanup({ discard: true, silent: true }));
  recordButton.addEventListener("click", () => setRecording(!recording));
  reviewButton.addEventListener("click", openPanel);
  panel
    .querySelector('[data-review-option="parent"]')
    .addEventListener("change", (event) => {
      parentMode = event.target.checked;
      renderReviewPanel();
      persistSession(true);
    });
  popover.addEventListener("keydown", (event) => {
    if (
      event.isComposing ||
      event.repeat ||
      !(event.metaKey || event.ctrlKey) ||
      event.key !== "Enter"
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (!popover.querySelector('[data-note-action="save"]').disabled)
      saveNote();
  });
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("click", onPageClick, true);
  document.addEventListener("click", onRecordedClick, true);
  document.addEventListener("change", onRecordedChange, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("wheel", onWheel, { capture: true, passive: false });
  document.addEventListener("scroll", queueRefresh, true);
  window.addEventListener("resize", queueRefresh);
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("doppie-assist:diagnostic", onDiagnosticEvent);

  populateRouting();
  renderRecordingState();
  renderSession();
  refreshDevBridgeStatus();
  bridgeCheckTimer = setInterval(refreshDevBridgeStatus, 2000);
  persistSession(true);
  chrome.runtime.sendMessage({ type: "install-page-monitor" }).catch(() => {});
  if (restoredDraft)
    showPageToast(
      `Review restored with ${annotations.length} ${annotations.length === 1 ? "annotation" : "annotations"}.`,
    );
  activeReviewSession = {
    cleanup,
    focus() {
      layer
        .querySelector(".doppie-session-bar")
        .animate(
          [
            { transform: "translateX(-50%) scale(1)" },
            { transform: "translateX(-50%) scale(1.025)" },
            { transform: "translateX(-50%) scale(1)" },
          ],
          { duration: 260 },
      );
    },
  };
  if (restoredDraft?.recording) restoreRecordingState();
}

chrome.storage.local
  .get("activeReviewSessionDraft")
  .then(({ activeReviewSessionDraft }) => {
    if (
      activeReviewSessionDraft?.recording &&
      activeReviewSessionDraft.origin === location.origin &&
      Date.now() - activeReviewSessionDraft.updatedAt < 8 * 60 * 60 * 1000 &&
      !activeReviewSession
    )
      startMultiAnnotation();
  })
  .catch(() => {});

function describeElement(element) {
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${element.id}`;
  const className = [...element.classList].find(
    (name) => !name.startsWith("margin-"),
  );
  return className ? `${tag}.${className}` : tag;
}

function escapeMarkup(value = "") {
  return String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
  );
}

function buildElementSelector(element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const segments = [];
  let current = element;
  while (
    current &&
    current.nodeType === Node.ELEMENT_NODE &&
    segments.length < 5
  ) {
    let segment = current.tagName.toLowerCase();
    const classes = [...current.classList]
      .filter(
        (name) => !name.startsWith("margin-") && !name.startsWith("doppie-"),
      )
      .slice(0, 2);
    if (classes.length)
      segment += classes.map((name) => `.${CSS.escape(name)}`).join("");
    const parent = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(
        (sibling) => sibling.tagName === current.tagName,
      );
      if (siblings.length > 1)
        segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    segments.unshift(segment);
    const selector = segments.join(" > ");
    try {
      if (document.querySelectorAll(selector).length === 1) return selector;
    } catch (_) {
      // Continue building a more specific path.
    }
    current = parent;
  }
  return segments.join(" > ");
}

function getElementText(element) {
  return (element.innerText || element.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

function getElementContext(element) {
  const rect = element.getBoundingClientRect();
  return {
    tagName: element.tagName.toLowerCase(),
    html: getSanitizedElementHtml(element),
    bounds: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      pageX: Math.round(rect.left + window.scrollX),
      pageY: Math.round(rect.top + window.scrollY),
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
    },
  };
}

function getSanitizedElementHtml(element) {
  const clone = element.cloneNode(true);
  clone
    .querySelectorAll?.("script, style, noscript, iframe")
    .forEach((node) => node.remove());
  [clone, ...(clone.querySelectorAll?.("*") || [])].forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      if (
        attribute.name.startsWith("on") ||
        ["value", "srcdoc"].includes(attribute.name)
      )
        node.removeAttribute(attribute.name);
      if (
        ["src", "srcset"].includes(attribute.name) &&
        /^(data|blob):/i.test(attribute.value)
      )
        node.setAttribute(attribute.name, "[embedded source omitted]");
    });
  });
  const html = clone.outerHTML.replace(/\s+/g, " ").trim();
  return html.length > 2000 ? `${html.slice(0, 1997)}...` : html;
}

async function captureAndEdit(rect, metadata) {
  await nextPaint();
  try {
    const response = await chrome.runtime.sendMessage({
      type: "capture-visible-tab",
    });
    if (!response?.ok) throw new Error(response?.error || "Capture failed");
    const crop = await cropScreenshot(response.dataUrl, rect);
    openAnnotationEditor({ ...crop, ...metadata });
  } catch (error) {
    showPageToast(error.message || "Could not capture this page");
  }
}

function normalizeRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function nextPaint() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}

function cropScreenshot(dataUrl, rect) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scaleX = image.naturalWidth / window.innerWidth;
      const scaleY = image.naturalHeight / window.innerHeight;
      const sourceX = Math.max(0, Math.floor(rect.x * scaleX));
      const sourceY = Math.max(0, Math.floor(rect.y * scaleY));
      const sourceRight = Math.min(
        image.naturalWidth,
        Math.ceil((rect.x + rect.width) * scaleX),
      );
      const sourceBottom = Math.min(
        image.naturalHeight,
        Math.ceil((rect.y + rect.height) * scaleY),
      );
      const source = {
        x: sourceX,
        y: sourceY,
        width: Math.max(1, sourceRight - sourceX),
        height: Math.max(1, sourceBottom - sourceY),
      };
      const maxWidth = 1800;
      const outputScale = Math.min(1, maxWidth / source.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.width * outputScale));
      canvas.height = Math.max(1, Math.round(source.height * outputScale));
      canvas
        .getContext("2d")
        .drawImage(
          image,
          source.x,
          source.y,
          source.width,
          source.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      resolve({
        dataUrl: canvas.toDataURL("image/jpeg", 0.92),
        width: canvas.width,
        height: canvas.height,
      });
    };
    image.onerror = () => reject(new Error("Could not process screenshot"));
    image.src = dataUrl;
  });
}

function markViewportScreenshot(dataUrl, targetRect, markerNumber) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxWidth = 1800;
      const outputScale = Math.min(1, maxWidth / image.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * outputScale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * outputScale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const scaleX = canvas.width / window.innerWidth;
      const scaleY = canvas.height / window.innerHeight;
      const x = Math.max(1, targetRect.left * scaleX);
      const y = Math.max(1, targetRect.top * scaleY);
      const width = Math.max(2, Math.min(canvas.width - x - 1, targetRect.width * scaleX));
      const height = Math.max(2, Math.min(canvas.height - y - 1, targetRect.height * scaleY));
      const lineWidth = Math.max(3, Math.round(3 * outputScale));
      context.strokeStyle = "#f83505";
      context.lineWidth = lineWidth;
      context.strokeRect(x, y, width, height);

      const radius = Math.max(13, Math.round(16 * outputScale));
      const markerX = Math.min(canvas.width - radius - 2, x + width);
      const markerY = Math.max(radius + 2, y);
      context.beginPath();
      context.arc(markerX, markerY, radius, 0, Math.PI * 2);
      context.fillStyle = "#e8f76b";
      context.fill();
      context.lineWidth = Math.max(2, Math.round(2 * outputScale));
      context.strokeStyle = "#080a0b";
      context.stroke();
      context.fillStyle = "#080a0b";
      context.font = `800 ${Math.max(13, Math.round(15 * outputScale))}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(markerNumber), markerX, markerY + 1);

      resolve({
        dataUrl: canvas.toDataURL("image/jpeg", 0.92),
        width: canvas.width,
        height: canvas.height,
      });
    };
    image.onerror = () => reject(new Error("Could not process screenshot"));
    image.src = dataUrl;
  });
}

function openAnnotationEditor(crop) {
  document.querySelector(".margin-editor-layer")?.remove();
  const editor = document.createElement("div");
  editor.className = "margin-editor-layer";
  editor.innerHTML = `
    <section class="margin-editor" role="dialog" aria-label="Annotate screenshot">
      <header><div><img class="margin-editor-mark" src="${chrome.runtime.getURL("assets/icon-32.png")}" alt=""><strong>Mark up capture</strong><small>${crop.label ? `${crop.label} · ` : ""}${crop.width} × ${crop.height}</small></div><button data-action="close" title="Cancel">×</button></header>
      <div class="margin-workspace">
        <nav class="margin-tools" aria-label="Annotation tools">
          <button class="active" data-tool="pen" title="Pen"><span>⌁</span><small>Pen</small></button>
          <button data-tool="rect" title="Rectangle"><span>□</span><small>Box</small></button>
          <button data-tool="arrow" title="Arrow"><span>→</span><small>Arrow</small></button>
          <i></i>
          <button data-action="undo" title="Undo"><span>↶</span><small>Undo</small></button>
          <button data-action="clear" title="Clear all"><span>⌫</span><small>Clear</small></button>
        </nav>
        <div class="margin-canvas-wrap"><canvas></canvas></div>
      </div>
      <footer><span><i></i> Annotation color</span><div><button class="margin-cancel" data-action="close">Cancel</button><button class="margin-save" data-action="save">Save capture <b>↗</b></button></div></footer>
    </section>`;
  document.documentElement.appendChild(editor);

  const canvas = editor.querySelector("canvas");
  const context = canvas.getContext("2d");
  const image = new Image();
  const operations = [];
  let tool = "pen";
  let current = null;
  canvas.width = crop.width;
  canvas.height = crop.height;

  const close = () => {
    editor.remove();
    document.removeEventListener("keydown", onKeyDown, true);
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") close();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      operations.pop();
      redraw();
    }
  };
  document.addEventListener("keydown", onKeyDown, true);

  image.onload = redraw;
  image.src = crop.dataUrl;

  function pointFromEvent(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * canvas.width) / bounds.width,
      y: ((event.clientY - bounds.top) * canvas.height) / bounds.height,
    };
  }

  function redraw() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    [...operations, ...(current ? [current] : [])].forEach(drawOperation);
  }

  function drawOperation(operation) {
    context.save();
    context.strokeStyle = "#ee5c48";
    context.fillStyle = "#ee5c48";
    context.lineWidth = Math.max(4, canvas.width / 300);
    context.lineCap = "round";
    context.lineJoin = "round";
    if (operation.tool === "pen") {
      context.beginPath();
      operation.points.forEach((point, index) =>
        index
          ? context.lineTo(point.x, point.y)
          : context.moveTo(point.x, point.y),
      );
      context.stroke();
    } else if (operation.tool === "rect") {
      context.strokeRect(
        operation.start.x,
        operation.start.y,
        operation.end.x - operation.start.x,
        operation.end.y - operation.start.y,
      );
    } else if (operation.tool === "arrow") {
      const angle = Math.atan2(
        operation.end.y - operation.start.y,
        operation.end.x - operation.start.x,
      );
      const head = Math.max(14, canvas.width / 35);
      context.beginPath();
      context.moveTo(operation.start.x, operation.start.y);
      context.lineTo(operation.end.x, operation.end.y);
      context.lineTo(
        operation.end.x - head * Math.cos(angle - Math.PI / 6),
        operation.end.y - head * Math.sin(angle - Math.PI / 6),
      );
      context.moveTo(operation.end.x, operation.end.y);
      context.lineTo(
        operation.end.x - head * Math.cos(angle + Math.PI / 6),
        operation.end.y - head * Math.sin(angle + Math.PI / 6),
      );
      context.stroke();
    }
    context.restore();
  }

  canvas.addEventListener("pointerdown", (event) => {
    const point = pointFromEvent(event);
    current =
      tool === "pen"
        ? { tool, points: [point] }
        : { tool, start: point, end: point };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!current) return;
    const point = pointFromEvent(event);
    if (current.tool === "pen") current.points.push(point);
    else current.end = point;
    redraw();
  });
  canvas.addEventListener("pointerup", () => {
    if (current) operations.push(current);
    current = null;
    redraw();
  });

  editor.querySelectorAll("[data-tool]").forEach((button) =>
    button.addEventListener("click", () => {
      editor
        .querySelectorAll("[data-tool]")
        .forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      tool = button.dataset.tool;
    }),
  );
  editor
    .querySelectorAll('[data-action="close"]')
    .forEach((button) => button.addEventListener("click", close));
  editor.querySelector('[data-action="undo"]').addEventListener("click", () => {
    operations.pop();
    redraw();
  });
  editor
    .querySelector('[data-action="clear"]')
    .addEventListener("click", () => {
      operations.length = 0;
      redraw();
    });
  const saveButton = editor.querySelector('[data-action="save"]');
  saveButton.addEventListener("click", async () => {
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    saveButton.innerHTML = "Opening composer... <b>↗</b>";
    const capture = {
      dataUrl: canvas.toDataURL("image/jpeg", 0.9),
      width: canvas.width,
      height: canvas.height,
      url: location.href,
      title: document.title,
      mode: crop.mode,
      label: crop.label,
      createdAt: Date.now(),
    };
    const { captures = [] } = await chrome.storage.local.get("captures");
    captures.unshift(capture);
    await chrome.storage.local.set({ captures: captures.slice(0, 20) });
    close();
    try {
      const response = await chrome.runtime.sendMessage({
        type: "open-issue-composer",
        captureCreatedAt: capture.createdAt,
      });
      if (!response?.ok) throw new Error(response?.error);
    } catch (_) {
      showPageToast("Capture saved. Click Doppie Assist to create the issue.");
    }
  });
}

function showPageToast(message) {
  document.querySelector(".margin-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "margin-toast";
  toast.innerHTML = `<span></span>${message}`;
  document.documentElement.appendChild(toast);
  setTimeout(() => toast.classList.add("visible"), 10);
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 200);
  }, 2600);
}
