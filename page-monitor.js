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
      for (const key of [...url.searchParams.keys()])
        url.searchParams.set(key, "[redacted]");
      if (url.hash) url.hash = "#[redacted]";
      return url.href.slice(0, 500);
    } catch (_) {
      return redact(value).slice(0, 500);
    }
  };
  const elapsed = (startedAt) =>
    Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10);
  const responseSize = (value) => {
    const size = Number.parseInt(value || "", 10);
    return Number.isFinite(size) && size >= 0 ? size : undefined;
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

  const networkDetail = (detail) => ({
    category: "network",
    ...detail,
  });

  const isReviewUi = (element) =>
    element?.closest?.(
      ".doppie-review-layer, .margin-capture-layer, .margin-element-layer, .margin-editor-layer, .margin-toast",
    );

  const describeTarget = (element) => {
    if (!(element instanceof Element)) return "page";
    const label = clean(
      element.getAttribute("aria-label") ||
        element.getAttribute("data-testid") ||
        element.getAttribute("data-test") ||
        element.id ||
        element.getAttribute("name") ||
        element.textContent,
    ).slice(0, 100);
    return `${element.tagName.toLowerCase()}${label ? ` “${label}”` : ""}`;
  };

  ["error", "warn"].forEach((level) => {
    const original = console[level];
    console[level] = function (...args) {
      emit({
        category: "diagnostic",
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
          category: "diagnostic",
          type: "resource-error",
          message: `Failed to load ${resource.tagName?.toLowerCase() || "resource"}`,
          url: safeUrl(resource.currentSrc || resource.src || resource.href),
        });
        return;
      }
      emit({
        category: "diagnostic",
        type: "runtime-error",
        message: clean(event.message || "Unknown runtime error").slice(0, 1000),
        url: safeUrl(event.filename || location.href),
      });
    },
    true,
  );

  window.addEventListener("unhandledrejection", (event) =>
    emit({
      category: "diagnostic",
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
    const startedAt = performance.now();
    try {
      const response = await originalFetch.apply(this, args);
      emit(
        networkDetail({
          type: "fetch",
          method,
          status: response.status,
          ok: response.ok,
          durationMs: elapsed(startedAt),
          contentType: clean(response.headers?.get("content-type")).slice(0, 120),
          size: responseSize(response.headers?.get("content-length")),
          redirected: response.redirected,
          message: response.statusText || (response.ok ? "Completed" : "Request failed"),
          url: safeUrl(response.url || url),
        }),
      );
      return response;
    } catch (error) {
      emit(
        networkDetail({
          type: "fetch",
          method,
          status: 0,
          ok: false,
          durationMs: elapsed(startedAt),
          message: clean(error?.message || "Request failed").slice(0, 1000),
          url,
        }),
      );
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
    const startedAt = performance.now();
    this.addEventListener("loadend", () => {
      let contentType = "";
      let size;
      try {
        contentType = clean(this.getResponseHeader("content-type")).slice(0, 120);
        size = responseSize(this.getResponseHeader("content-length"));
      } catch (_) {}
      emit(
        networkDetail({
          type: "xhr",
          method: this.__doppieRequest?.method || "GET",
          status: this.status,
          ok: this.status >= 200 && this.status < 400,
          durationMs: elapsed(startedAt),
          contentType,
          size,
          message: this.statusText || (this.status ? "Completed" : "Request failed"),
          url: safeUrl(this.responseURL || this.__doppieRequest?.url),
        }),
      );
    });
    return xhrSend.apply(this, args);
  };

  if (typeof PerformanceObserver === "function") {
    const resourceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (["fetch", "xmlhttprequest"].includes(entry.initiatorType)) continue;
        emit(
          networkDetail({
            type: "resource",
            resourceType: entry.initiatorType || "other",
            method: "GET",
            status: Number(entry.responseStatus) || undefined,
            ok:
              Number(entry.responseStatus) > 0
                ? Number(entry.responseStatus) < 400
                : undefined,
            durationMs: Math.round(entry.duration * 10) / 10,
            size: Number(entry.transferSize) || undefined,
            encodedSize: Number(entry.encodedBodySize) || undefined,
            protocol: entry.nextHopProtocol || undefined,
            message: "Resource loaded",
            url: safeUrl(entry.name),
          }),
        );
      }
    });
    resourceObserver.observe({ type: "resource", buffered: false });
    state.resourceObserver = resourceObserver;
  }

  document.addEventListener(
    "click",
    (event) => {
      if (isReviewUi(event.target)) return;
      emit({
        category: "event",
        type: "click",
        message: `Click ${describeTarget(event.target)}`,
        url: safeUrl(location.href),
      });
    },
    true,
  );
  document.addEventListener(
    "change",
    (event) => {
      if (isReviewUi(event.target)) return;
      emit({
        category: "event",
        type: "change",
        message: `Change ${describeTarget(event.target)} (value omitted)`,
        url: safeUrl(location.href),
      });
    },
    true,
  );
  document.addEventListener(
    "submit",
    (event) => {
      if (isReviewUi(event.target)) return;
      emit({
        category: "event",
        type: "submit",
        message: `Submit ${describeTarget(event.target)}`,
        url: safeUrl(event.target?.action || location.href),
      });
    },
    true,
  );
  document.addEventListener("visibilitychange", () =>
    emit({
      category: "event",
      type: "visibility",
      message: `Page became ${document.visibilityState}`,
      url: safeUrl(location.href),
    }),
  );

  const emitNavigation = () => {
    const url = new URL(safeUrl(location.href));
    emit({
      category: "event",
      type: "navigation",
      message: `Navigate to ${url.pathname}${url.search}${url.hash}`,
      url: url.href,
    });
  };
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
