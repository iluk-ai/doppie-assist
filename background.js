const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const LINEAR_REVOKE_URL = "https://api.linear.app/oauth/revoke";
const LINEAR_SCOPES = "read,write,issues:create";
const LINEAR_OAUTH_REDIRECT_PATH = "linear";
const DEFAULT_LINEAR_OAUTH_CLIENT_ID = "e0018f12b51653925dce65a8a48e355f";
const DEV_BRIDGE_URL = "http://127.0.0.1:47361";
const RELEASE_API =
  "https://api.github.com/repos/iluk-ai/doppie-assist/releases/latest";
const RELEASE_DOWNLOAD_PATH = "/iluk-ai/doppie-assist/releases/download/";
const RELEASE_ASSET_PATTERN =
  /^doppie-assist-browser-extension-v[\d.]+\.zip$/i;
const UPDATE_ALARM = "doppie-assist-update-check";
const UPDATE_CHECK_MINUTES = 6 * 60;
const UPDATE_CACHE_MS = UPDATE_CHECK_MINUTES * 60 * 1000;
const OFFSCREEN_RECORDER_URL = "offscreen.html";
let refreshPromise = null;
let offscreenCreatePromise = null;

const versionParts = (value) =>
  String(value || "0")
    .replace(/^v/i, "")
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);

const isNewerVersion = (candidate, current) => {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if ((next[index] || 0) > (installed[index] || 0)) return true;
    if ((next[index] || 0) < (installed[index] || 0)) return false;
  }
  return false;
};

const trustedReleaseUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith(RELEASE_DOWNLOAD_PATH)
      ? url.href
      : "";
  } catch (_) {
    return "";
  }
};

const updateBadge = async (release) => {
  if (!chrome.action) return false;
  const currentVersion = chrome.runtime.getManifest().version;
  const available = Boolean(
    release && isNewerVersion(release.version, currentVersion),
  );
  await chrome.action.setBadgeText({ text: available ? "UP" : "" });
  if (available) {
    await chrome.action.setBadgeBackgroundColor({ color: "#d8ff59" });
    if (chrome.action.setBadgeTextColor)
      await chrome.action.setBadgeTextColor({ color: "#17201b" });
  }
  await chrome.action.setTitle({
    title: available
      ? `Doppie Assist - ${release.tagName} available`
      : "Doppie Assist",
  });
  return available;
};

const checkForUpdates = async ({ force = false } = {}) => {
  const { latestReleaseCheck } = await chrome.storage.local.get(
    "latestReleaseCheck",
  );
  let release = latestReleaseCheck || null;
  if (
    force ||
    !release?.checkedAt ||
    Date.now() - release.checkedAt > UPDATE_CACHE_MS
  ) {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok)
      throw new Error(`GitHub update check failed (${response.status})`);
    const payload = await response.json();
    const asset = payload.assets?.find(
      (item) =>
        RELEASE_ASSET_PATTERN.test(item.name) && item.browser_download_url,
    );
    if (!asset) throw new Error("The latest release has no extension package");
    const downloadUrl = trustedReleaseUrl(asset.browser_download_url);
    if (!downloadUrl)
      throw new Error("GitHub returned an unexpected download URL");
    release = {
      tagName: payload.tag_name,
      version: String(payload.tag_name || "").replace(/^v/i, ""),
      assetName: asset.name,
      downloadUrl,
      releaseUrl: payload.html_url,
      checkedAt: Date.now(),
    };
    await chrome.storage.local.set({ latestReleaseCheck: release });
  }
  return { release, available: await updateBadge(release) };
};

const scheduleUpdateChecks = async () => {
  if (!chrome.alarms) return;
  await chrome.alarms.create(UPDATE_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: UPDATE_CHECK_MINUTES,
  });
};

const ensureOffscreenRecorder = async () => {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_RECORDER_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl],
  });
  if (contexts.length) return;
  if (!offscreenCreatePromise) {
    offscreenCreatePromise = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_RECORDER_URL,
        reasons: ["USER_MEDIA"],
        justification: "Record the reviewed tab while the user records a flow",
      })
      .finally(() => {
        offscreenCreatePromise = null;
      });
  }
  await offscreenCreatePromise;
};

const startFlowVideo = async (tabId, sessionId) => {
  if (!Number.isInteger(tabId)) throw new Error("No active tab available");
  await ensureOffscreenRecorder();
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId,
  });
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start-flow-video",
    streamId,
    sessionId,
  });
  if (!response?.ok)
    throw new Error(response?.error || "Could not start tab recording");
  return response;
};

const stopFlowVideo = async (sessionId) => {
  await ensureOffscreenRecorder();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "stop-flow-video",
    sessionId,
  });
  if (!response?.ok)
    throw new Error(response?.error || "Could not finish tab recording");
  return response.video;
};

const getFlowVideoStatus = async (sessionId) => {
  await ensureOffscreenRecorder();
  return chrome.runtime.sendMessage({
    target: "offscreen",
    type: "flow-video-status",
    sessionId,
  });
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(
    ["captures", "issues", "linearConfig", "linearAuth"],
    (result) => {
      const updates = {};
      if (!result.captures) updates.captures = [];
      if (!result.issues) updates.issues = [];
      if (!result.linearAuth && result.linearConfig?.apiKey) {
        updates.linearAuth = {
          type: "apiKey",
          apiKey: result.linearConfig.apiKey,
        };
        const { apiKey: _apiKey, ...config } = result.linearConfig;
        updates.linearConfig = {
          ...config,
          connected: true,
          authType: "apiKey",
        };
      }
      if (Object.keys(updates).length) chrome.storage.local.set(updates);
    },
  );
  scheduleUpdateChecks();
  checkForUpdates({ force: true }).catch(() => {});
});

chrome.runtime.onStartup?.addListener(() => {
  scheduleUpdateChecks();
  checkForUpdates().catch(() => {});
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM)
    checkForUpdates({ force: true }).catch(() => {});
});

const linearRequestWithAuthorization = async (
  authorization,
  query,
  variables = {},
) => {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    const error = payload.errors?.[0];
    const requestError = new Error(
      error?.extensions?.userPresentableMessage ||
        error?.extensions?.validationErrors?.[0]?.message ||
        error?.message ||
        `Linear request failed (${response.status})`,
    );
    requestError.status = response.status;
    throw requestError;
  }
  return payload.data;
};

const oauthTokenRequest = async (parameters) => {
  const response = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error_description || payload.error || "Linear OAuth failed",
    );
  }
  if (!payload.access_token)
    throw new Error("Linear did not return an access token");
  return payload;
};

const storedOAuthToken = (current, payload) => ({
  type: "oauth",
  clientId: current.clientId,
  accessToken: payload.access_token,
  refreshToken: payload.refresh_token || current.refreshToken,
  expiresAt: Date.now() + Number(payload.expires_in || 86400) * 1000,
  scope: payload.scope || current.scope || LINEAR_SCOPES,
});

const migrateLegacyLinearAuth = async () => {
  const { linearAuth, linearConfig } = await chrome.storage.local.get([
    "linearAuth",
    "linearConfig",
  ]);
  if (linearAuth || !linearConfig?.apiKey) return linearAuth || null;
  const migrated = { type: "apiKey", apiKey: linearConfig.apiKey };
  const { apiKey: _apiKey, ...config } = linearConfig;
  await chrome.storage.local.set({
    linearAuth: migrated,
    linearConfig: { ...config, connected: true, authType: "apiKey" },
  });
  return migrated;
};

const refreshOAuthToken = async (auth) => {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    if (!auth.refreshToken) throw new Error("Reconnect Linear to continue");
    const payload = await oauthTokenRequest({
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken,
      client_id: auth.clientId,
    });
    const refreshed = storedOAuthToken(auth, payload);
    await chrome.storage.local.set({ linearAuth: refreshed });
    return refreshed;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
};

const getValidLinearAuth = async ({ forceRefresh = false } = {}) => {
  let auth = await migrateLegacyLinearAuth();
  if (!auth) throw new Error("Connect Linear first");
  if (
    auth.type === "oauth" &&
    (forceRefresh || !auth.accessToken || auth.expiresAt <= Date.now() + 60000)
  )
    auth = await refreshOAuthToken(auth);
  return auth;
};

const authorizationFor = (auth) => {
  if (auth.type === "oauth") return `Bearer ${auth.accessToken}`;
  if (auth.type === "apiKey" && auth.apiKey) return auth.apiKey;
  throw new Error("Reconnect Linear to continue");
};

const linearRequest = async (query, variables = {}, allowRefresh = true) => {
  let auth = await getValidLinearAuth();
  try {
    return await linearRequestWithAuthorization(
      authorizationFor(auth),
      query,
      variables,
    );
  } catch (error) {
    if (error.status !== 401 || auth.type !== "oauth" || !allowRefresh)
      throw error;
    auth = await getValidLinearAuth({ forceRefresh: true });
    return linearRequestWithAuthorization(
      authorizationFor(auth),
      query,
      variables,
    );
  }
};

const connectionQuery = `query DoppieAssistConnection {
  viewer { id name }
  teams { nodes { id name key } }
  users(first: 250) { nodes { id name displayName active } }
  projects(first: 100, includeArchived: false) { nodes { id name } }
  issueLabels(first: 250) { nodes { id name color } }
}`;

const configFromConnection = (data, authType) => ({
  connected: true,
  authType,
  viewer: data.viewer,
  teams: data.teams.nodes,
  users: data.users.nodes.filter((user) => user.active),
  projects: data.projects.nodes,
  labels: data.issueLabels.nodes,
});

const saveConnection = async (data, authType) => {
  const config = configFromConnection(data, authType);
  await chrome.storage.local.set({ linearConfig: config });
  return config;
};

const bytesToBase64Url = (bytes) => {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

const randomBase64Url = (length = 32) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
};

const sha256Base64Url = async (value) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(digest));
};

const connectLinearOAuth = async (providedClientId) => {
  const { linearOAuthClientId } = await chrome.storage.local.get(
    "linearOAuthClientId",
  );
  const clientId = String(
    providedClientId || linearOAuthClientId || DEFAULT_LINEAR_OAUTH_CLIENT_ID,
  ).trim();
  if (!clientId) throw new Error("Add the Linear OAuth client ID first");
  const redirectUri = chrome.identity.getRedirectURL(
    LINEAR_OAUTH_REDIRECT_PATH,
  );
  const state = randomBase64Url();
  const verifier = randomBase64Url(64);
  const challenge = await sha256Base64Url(verifier);
  await chrome.storage.session.set({
    linearOAuthAttempt: {
      clientId,
      redirectUri,
      state,
      verifier,
      createdAt: Date.now(),
    },
  });
  await chrome.storage.local.set({ linearOAuthClientId: clientId });
  const authorizationUrl = new URL(LINEAR_AUTHORIZE_URL);
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: LINEAR_SCOPES,
    prompt: "consent",
    actor: "user",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authorizationUrl.href,
    interactive: true,
  });
  if (!responseUrl) throw new Error("Linear authorization was cancelled");
  const callback = new URL(responseUrl);
  const expectedCallback = new URL(redirectUri);
  if (
    callback.origin !== expectedCallback.origin ||
    callback.pathname !== expectedCallback.pathname
  )
    throw new Error("Linear returned an unexpected callback URL");
  if (callback.searchParams.get("state") !== state)
    throw new Error("Linear authorization state did not match");
  if (callback.searchParams.get("error"))
    throw new Error(
      callback.searchParams.get("error_description") ||
        callback.searchParams.get("error"),
    );
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("Linear did not return an authorization code");
  const payload = await oauthTokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  const auth = storedOAuthToken({ clientId }, payload);
  await chrome.storage.local.set({ linearAuth: auth });
  await chrome.storage.session.remove("linearOAuthAttempt");
  const data = await linearRequestWithAuthorization(
    authorizationFor(auth),
    connectionQuery,
  );
  return saveConnection(data, "oauth");
};

const dataUrlToBlob = (dataUrl) => {
  const match =
    /^data:((?:image\/(?:jpeg|png|webp))|(?:video\/(?:webm|mp4)));base64,([a-z0-9+/=\s]+)$/i.exec(
      dataUrl || "",
    );
  if (!match) throw new Error("Evidence format is not supported");
  const bytes = Uint8Array.from(atob(match[2].replace(/\s/g, "")), (value) =>
    value.charCodeAt(0),
  );
  return new Blob([bytes], { type: match[1].toLowerCase() });
};

const uploadFileToLinear = async (dataUrl, filename) => {
  const file = dataUrlToBlob(dataUrl);
  const data = await linearRequest(
    `mutation DoppieAssistFileUpload(
      $contentType: String!
      $filename: String!
      $size: Int!
    ) {
      fileUpload(
        contentType: $contentType
        filename: $filename
        size: $size
      ) {
        success
        uploadFile {
          assetUrl
          uploadUrl
          headers { key value }
        }
      }
    }`,
    {
      contentType: file.type,
      filename,
      size: file.size,
    },
  );
  const upload = data.fileUpload?.uploadFile;
  if (!data.fileUpload?.success || !upload?.uploadUrl || !upload.assetUrl)
    throw new Error("Linear did not provide an evidence upload URL");

  const headers = new Headers({
    "Content-Type": file.type,
    "Cache-Control": "public, max-age=31536000",
  });
  (upload.headers || []).forEach(({ key, value }) => headers.set(key, value));
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers,
    body: file,
  });
  if (!response.ok)
    throw new Error(`Evidence upload failed (${response.status})`);
  return upload.assetUrl;
};

const normalizedIssueInput = (input = {}) => {
  const normalized = {
    title: String(input.title || "")
      .trim()
      .slice(0, 255),
    teamId: String(input.teamId || "").trim(),
    description: String(input.description || "").trim(),
  };
  if (!normalized.title || !normalized.teamId)
    throw new Error("Each issue needs a title and Linear team");
  if ([1, 2, 3, 4].includes(Number(input.priority)))
    normalized.priority = Number(input.priority);
  if (input.assigneeId) normalized.assigneeId = String(input.assigneeId);
  if (input.projectId) normalized.projectId = String(input.projectId);
  if (input.parentId) normalized.parentId = String(input.parentId);
  if (Array.isArray(input.labelIds) && input.labelIds.length)
    normalized.labelIds = [...new Set(input.labelIds.map(String))];
  return normalized;
};

const revokeOAuthToken = async (token, tokenType) => {
  if (!token) return;
  const response = await fetch(LINEAR_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, token_type_hint: tokenType }),
  });
  if (!response.ok && response.status !== 400)
    throw new Error(`Linear token revocation failed (${response.status})`);
};

const devBridgeRequest = async (path, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 1200);
  try {
    const response = await fetch(`${DEV_BRIDGE_URL}${path}`, {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        "X-Doppie-Assist": "browser-extension",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false)
      throw new Error(payload.error || `Developer bridge failed (${response.status})`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "offscreen") return false;

  if (message.type === "open-shortcut-settings") {
    chrome.tabs
      .create({ url: "chrome://extensions/shortcuts", active: true })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "start-flow-video") {
    startFlowVideo(sender.tab?.id, message.sessionId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "stop-flow-video") {
    stopFlowVideo(message.sessionId)
      .then((video) => sendResponse({ ok: true, video }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "flow-video-status") {
    getFlowVideoStatus(message.sessionId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "check-for-updates") {
    checkForUpdates({ force: Boolean(message.force) })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "install-page-monitor") {
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: "No active page available" });
      return false;
    }
    chrome.scripting
      .executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
        files: ["page-monitor.js"],
        world: "MAIN",
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "capture-visible-tab") {
    chrome.tabs
      .captureVisibleTab(sender.tab?.windowId, { format: "png" })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "dev-bridge-status") {
    devBridgeRequest("/status")
      .then((status) => sendResponse({ ok: true, connected: true, ...status }))
      .catch(() => sendResponse({ ok: true, connected: false }));
    return true;
  }

  if (message.type === "dev-bridge-submit") {
    devBridgeRequest("/annotations", {
      method: "POST",
      body: message.bundle,
      timeout: 15000,
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "selection") {
    chrome.storage.local.set({
      lastSelection: {
        text: message.text,
        url: message.url,
        title: message.title,
      },
    });
    return false;
  }

  if (message.type === "open-issue-composer") {
    (async () => {
      await chrome.storage.local.set({
        pendingComposer: {
          captureCreatedAt: message.captureCreatedAt,
          requestedAt: Date.now(),
        },
      });

      try {
        const options = Number.isInteger(sender.tab?.windowId)
          ? { windowId: sender.tab.windowId }
          : {};
        await chrome.action.openPopup(options);
        sendResponse({ ok: true, mode: "popup" });
      } catch (_) {
        await chrome.windows.create({
          url: chrome.runtime.getURL("popup.html?composer=1"),
          type: "popup",
          width: 420,
          height: 680,
          focused: true,
        });
        sendResponse({ ok: true, mode: "window" });
      }
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "linear-auth-info") {
    chrome.storage.local
      .get("linearOAuthClientId")
      .then(({ linearOAuthClientId }) =>
        sendResponse({
          ok: true,
          clientId: linearOAuthClientId || DEFAULT_LINEAR_OAUTH_CLIENT_ID || "",
          redirectUri: chrome.identity.getRedirectURL(
            LINEAR_OAUTH_REDIRECT_PATH,
          ),
          scopes: LINEAR_SCOPES,
        }),
      )
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "linear-oauth-connect") {
    connectLinearOAuth(message.clientId)
      .then((config) => sendResponse({ ok: true, ...config }))
      .catch((error) => sendResponse({ ok: false, error: error.message }))
      .finally(() => chrome.storage.session.remove("linearOAuthAttempt"));
    return true;
  }

  if (message.type === "linear-connect") {
    const apiKey = String(message.apiKey || "").trim();
    if (!apiKey) {
      sendResponse({ ok: false, error: "Enter your Linear API key" });
      return false;
    }
    linearRequestWithAuthorization(apiKey, connectionQuery)
      .then(async (data) => {
        await chrome.storage.local.set({
          linearAuth: { type: "apiKey", apiKey },
        });
        const config = await saveConnection(data, "apiKey");
        sendResponse({ ok: true, ...config });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "linear-disconnect") {
    (async () => {
      const auth = await migrateLegacyLinearAuth();
      let warning = "";
      if (auth?.type === "oauth") {
        try {
          await revokeOAuthToken(auth.refreshToken, "refresh_token");
        } catch (error) {
          warning = error.message;
        }
      }
      await chrome.storage.local.remove(["linearConfig", "linearAuth"]);
      await chrome.storage.session.remove("linearOAuthAttempt");
      sendResponse({ ok: true, warning });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "create-linear-issue") {
    getValidLinearAuth()
      .then(async () => {
        const input = normalizedIssueInput(message.input);
        const evidence = [
          ...(message.screenshot?.startsWith("data:image/")
            ? [
                {
                  dataUrl: message.screenshot,
                  filename:
                    message.screenshotName || `doppie-assist-${Date.now()}.jpg`,
                  alt: "Screenshot from Doppie Assist",
                },
              ]
            : []),
          ...(Array.isArray(message.screenshots) ? message.screenshots : []),
          ...(message.video?.dataUrl?.startsWith("data:video/")
            ? [
                {
                  dataUrl: message.video.dataUrl,
                  filename: message.video.filename || `doppie-flow-${Date.now()}.webm`,
                  alt: "Recorded flow video from Doppie Assist",
                },
              ]
            : []),
        ].slice(0, 10);
        if (evidence.length) {
          const images = [];
          for (let index = 0; index < evidence.length; index += 1) {
            const item = evidence[index];
            if (!item?.dataUrl?.startsWith("data:image/") &&
                !item?.dataUrl?.startsWith("data:video/"))
              continue;
            const assetUrl = await uploadFileToLinear(
              item.dataUrl,
              item.filename || `doppie-evidence-${index + 1}.jpg`,
            );
            const alt = String(item.alt || `Evidence ${index + 1}`).replace(
              /[\[\]]/g,
              "",
            );
            images.push(
              item.dataUrl.startsWith("data:video/")
                ? `[${alt}](${assetUrl})`
                : `![${alt}](${assetUrl})`,
            );
          }
          if (images.length)
            input.description = `${input.description}\n\n## Evidence\n${images.join("\n\n")}`;
        }
        return linearRequest(
          `
        mutation DoppieAssistIssueCreate($input: IssueCreateInput!) {
          issueCreate(input: $input) { success issue { id identifier title url } }
        }
      `,
          { input },
        );
      })
      .then((data) => sendResponse({ ok: true, issue: data.issueCreate.issue }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const messageTypes = {
    "capture-region": "start-target-capture",
    "capture-element": "start-multi-annotation",
  };
  const type = messageTypes[command];
  if (!type) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || "")) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type });
  } catch (_) {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["dev-context.js", "issue-format.js", "content.js"],
    });
    await chrome.tabs.sendMessage(tab.id, { type });
  }
});
