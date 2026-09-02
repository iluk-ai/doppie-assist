(() => {
  if (window.__doppieAssistMonitor) {
    window.__doppieAssistMonitor.enabled = true;
    return;
  }

  const state = { enabled: true };
  window.__doppieAssistMonitor = state;
  const clean = (value = "") => String(value).replace(/\s+/g, " ").trim();
  const redact = (value = "") =>
    clean(value)
      .replace(
        /((?:authorization|api[-_ ]?key|access[-_ ]?token|password|secret)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
        "$1[redacted]",
      )
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  const safeUrl = (value) => {
    try {
      const url = new URL(String(value), location.href);
      return `${url.origin}${url.pathname}`;
    } catch (_) {
      return redact(value).slice(0, 500);
    }
  };
  const printable = (value) => {
    if (value instanceof Error)
      return redact(`${value.name}: ${value.message}`);
    if (typeof value === "string") return redact(value);
    try {
      return redact(JSON.stringify(value));
    } catch (_) {
      return redact(String(value));
    }
  };
  const emit = (detail) => {
    if (!state.enabled) return;
    window.dispatchEvent(
      new CustomEvent("doppie-assist:diagnostic", {
        detail: JSON.stringify({ ...detail, at: Date.now() }),
      }),
    );
  };

  ["error", "warn"].forEach((level) => {
    const original = console[level];
    console[level] = function (...args) {
      emit({
        type: `console-${level}`,
        message: args.map(printable).join(" ").slice(0, 1000),
        url: safeUrl(location.href),
      });
      return original.apply(this, args);
    };
  });

  window.addEventListener(
    "error",
    (event) => {
      const resource = event.target;
      if (resource && resource !== window) {
        emit({
          type: "resource-error",
          message: `Failed to load ${resource.tagName?.toLowerCase() || "resource"}`,
          url: safeUrl(resource.currentSrc || resource.src || resource.href),
        });
        return;
      }
      emit({
        type: "runtime-error",
        message: clean(event.message || "Unknown runtime error").slice(0, 1000),
        url: safeUrl(event.filename || location.href),
      });
    },
    true,
  );

  window.addEventListener("unhandledrejection", (event) =>
    emit({
      type: "unhandled-rejection",
      message: printable(event.reason).slice(0, 1000),
      url: safeUrl(location.href),
    }),
  );

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const request = args[0];
    const method = clean(
      args[1]?.method || request?.method || "GET",
    ).toUpperCase();
    const url = safeUrl(request?.url || request);
    try {
      const response = await originalFetch.apply(this, args);
      if (!response.ok)
        emit({
          type: "network-error",
          method,
          status: response.status,
          message: response.statusText || "Request failed",
          url,
        });
      return response;
    } catch (error) {
      emit({
        type: "network-error",
        method,
        status: 0,
        message: clean(error?.message || "Request failed").slice(0, 1000),
        url,
      });
      throw error;
    }
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__doppieRequest = {
      method: clean(method).toUpperCase(),
      url: safeUrl(url),
    };
    return xhrOpen.call(this, method, url, ...rest);
  };
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("loadend", () => {
      if (this.status >= 400 || this.status === 0)
        emit({
          type: "network-error",
          method: this.__doppieRequest?.method || "GET",
          status: this.status,
          message: this.statusText || "Request failed",
          url: this.__doppieRequest?.url || safeUrl(this.responseURL),
        });
    });
    return xhrSend.apply(this, args);
  };

  const emitNavigation = () =>
    emit({
      type: "navigation",
      message: `Navigate to ${location.pathname}${location.search}${location.hash}`,
      url: location.href,
    });
  ["pushState", "replaceState"].forEach((method) => {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      emitNavigation();
      return result;
    };
  });
  window.addEventListener("popstate", emitNavigation);
  window.addEventListener("hashchange", emitNavigation);
  window.addEventListener("doppie-assist:monitor-control", (event) => {
    state.enabled = event.detail !== "stop";
  });
})();
