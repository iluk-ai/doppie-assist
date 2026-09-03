(() => {
  const SENSITIVE_NAME =
    /(?:authorization|cookie|credential|password|passwd|secret|session|token|api[-_]?key)/i;
  const TEST_ATTRIBUTES = ["data-testid", "data-test", "data-cy"];
  const KEY_STYLE_PROPERTIES = [
    "display",
    "position",
    "z-index",
    "overflow",
    "overflow-x",
    "overflow-y",
    "visibility",
    "opacity",
    "box-sizing",
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "gap",
    "align-items",
    "justify-content",
    "grid-template-columns",
    "grid-template-rows",
    "flex-direction",
    "flex-wrap",
    "background-color",
    "color",
    "border",
    "border-radius",
    "box-shadow",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-align",
    "white-space",
  ];
  const DEBUG_STYLE_PROPERTIES = [
    ...KEY_STYLE_PROPERTIES,
    "inset",
    "top",
    "right",
    "bottom",
    "left",
    "transform",
    "transform-origin",
    "object-fit",
    "object-position",
    "cursor",
    "pointer-events",
    "user-select",
    "text-decoration",
    "text-transform",
    "word-break",
    "transition",
    "animation",
  ];

  const implicitRoles = {
    a: "link",
    article: "article",
    aside: "complementary",
    button: "button",
    details: "group",
    dialog: "dialog",
    footer: "contentinfo",
    form: "form",
    header: "banner",
    img: "img",
    li: "listitem",
    main: "main",
    nav: "navigation",
    ol: "list",
    option: "option",
    progress: "progressbar",
    section: "region",
    select: "combobox",
    summary: "button",
    table: "table",
    textarea: "textbox",
    ul: "list",
  };

  const inputRoles = {
    button: "button",
    checkbox: "checkbox",
    email: "textbox",
    number: "spinbutton",
    radio: "radio",
    range: "slider",
    search: "searchbox",
    submit: "button",
    tel: "textbox",
    text: "textbox",
    url: "textbox",
  };

  const compactText = (value = "", limit = 280) =>
    String(value).replace(/\s+/g, " ").trim().slice(0, limit);

  const cssEscape = (value) =>
    globalThis.CSS?.escape
      ? CSS.escape(String(value))
      : String(value).replace(/[^a-z0-9_-]/gi, (character) => `\\${character}`);

  const queryOne = (selector, root = document) => {
    if (!selector) return null;
    try {
      return root.querySelector(selector);
    } catch (_) {
      return null;
    }
  };

  const isUnique = (selector) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (_) {
      return false;
    }
  };

  function sanitizeUrl(value) {
    if (!value || /^(?:data|blob|javascript):/i.test(value))
      return "[source omitted]";
    try {
      const url = new URL(value, location.href);
      for (const key of [...url.searchParams.keys()])
        url.searchParams.set(key, "[redacted]");
      return url.href.slice(0, 300);
    } catch (_) {
      return compactText(value, 300);
    }
  }

  function sanitizeAttribute(name, value) {
    const normalizedName = String(name).toLowerCase();
    if (normalizedName.startsWith("on")) return null;
    if (["value", "srcdoc"].includes(normalizedName)) return null;
    if (SENSITIVE_NAME.test(normalizedName)) return "[redacted]";
    if (["href", "src", "srcset", "action", "formaction"].includes(normalizedName))
      return sanitizeUrl(value);
    return compactText(value, 220);
  }

  function getAttributes(element) {
    const attributes = {};
    for (const attribute of element.attributes || []) {
      if (["id", "class", "style"].includes(attribute.name)) continue;
      const value = sanitizeAttribute(attribute.name, attribute.value);
      if (value !== null) attributes[attribute.name] = value;
    }
    return attributes;
  }

  function generateSelector(element) {
    if (!element) return "";
    if (element.id) {
      const selector = `#${cssEscape(element.id)}`;
      if (isUnique(selector)) return selector;
    }

    for (const name of TEST_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (!value) continue;
      const selector = `[${name}="${cssEscape(value)}"]`;
      if (isUnique(selector)) return selector;
    }

    const classes = [...element.classList]
      .filter(
        (name) =>
          !name.startsWith("doppie-") &&
          !name.startsWith("margin-") &&
          name.length < 80,
      )
      .slice(0, 3);
    if (classes.length) {
      const selector = `${element.tagName.toLowerCase()}${classes
        .map((name) => `.${cssEscape(name)}`)
        .join("")}`;
      if (isUnique(selector)) return selector;
    }

    const segments = [];
    let current = element;
    while (current?.parentElement && segments.length < 7) {
      let segment = current.tagName.toLowerCase();
      if (current.id) {
        segments.unshift(`#${cssEscape(current.id)}`);
        break;
      }
      const stableClass = [...current.classList].find(
        (name) =>
          !name.startsWith("doppie-") &&
          !name.startsWith("margin-") &&
          name.length < 50,
      );
      if (stableClass) segment += `.${cssEscape(stableClass)}`;
      const siblings = [...current.parentElement.children].filter(
        (sibling) => sibling.tagName === current.tagName,
      );
      if (siblings.length > 1)
        segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      segments.unshift(segment);
      const selector = segments.join(" > ");
      if (isUnique(selector)) return selector;
      current = current.parentElement;
    }
    return segments.join(" > ");
  }

  function selectorCandidates(element) {
    const candidates = [generateSelector(element)];
    for (const name of TEST_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value) candidates.push(`[${name}="${cssEscape(value)}"]`);
    }
    if (element.getAttribute("aria-label"))
      candidates.push(
        `${element.tagName.toLowerCase()}[aria-label="${cssEscape(
          element.getAttribute("aria-label"),
        )}"]`,
      );
    return [...new Set(candidates.filter(Boolean))].slice(0, 5);
  }

  const numberValue = (value) => {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
  };

  function getBoxModel(element, style = getComputedStyle(element)) {
    const rect = element.getBoundingClientRect();
    const padding = {
      top: numberValue(style.paddingTop),
      right: numberValue(style.paddingRight),
      bottom: numberValue(style.paddingBottom),
      left: numberValue(style.paddingLeft),
    };
    const border = {
      top: numberValue(style.borderTopWidth),
      right: numberValue(style.borderRightWidth),
      bottom: numberValue(style.borderBottomWidth),
      left: numberValue(style.borderLeftWidth),
    };
    const margin = {
      top: numberValue(style.marginTop),
      right: numberValue(style.marginRight),
      bottom: numberValue(style.marginBottom),
      left: numberValue(style.marginLeft),
    };
    return {
      content: {
        width: Math.max(
          0,
          Math.round(rect.width - padding.left - padding.right - border.left - border.right),
        ),
        height: Math.max(
          0,
          Math.round(rect.height - padding.top - padding.bottom - border.top - border.bottom),
        ),
      },
      padding,
      border,
      margin,
    };
  }

  function implicitRole(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === "a" && !element.hasAttribute("href")) return null;
    if (tag === "input")
      return inputRoles[(element.getAttribute("type") || "text").toLowerCase()] ||
        "textbox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    return implicitRoles[tag] || null;
  }

  function accessibleName(element) {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ");
      if (compactText(label)) return compactText(label);
    }
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return compactText(ariaLabel);
    if (element.labels?.length)
      return compactText([...element.labels].map((label) => label.textContent).join(" "));
    return compactText(
      element.getAttribute("alt") ||
        element.getAttribute("title") ||
        element.innerText ||
        element.textContent,
    );
  }

  function getAccessibility(element) {
    const tag = element.tagName.toLowerCase();
    const tabIndex = element.tabIndex;
    const nativeFocusable =
      ["button", "input", "select", "textarea"].includes(tag) ||
      (tag === "a" && element.hasAttribute("href"));
    const state = {};
    for (const name of [
      "aria-checked",
      "aria-current",
      "aria-disabled",
      "aria-expanded",
      "aria-pressed",
      "aria-selected",
    ]) {
      if (element.hasAttribute(name)) state[name] = element.getAttribute(name);
    }
    return {
      role: element.getAttribute("role") || implicitRole(element),
      name: accessibleName(element),
      focusable: nativeFocusable || tabIndex >= 0,
      tabIndex,
      disabled:
        element.disabled === true || element.getAttribute("aria-disabled") === "true",
      states: state,
    };
  }

  function styleSnapshot(style, properties) {
    const result = {};
    for (const property of properties) {
      const value = compactText(style.getPropertyValue(property), 180);
      if (value && value !== "normal" && value !== "none" && value !== "auto")
        result[property] = value.replace(/url\([^)]*\)/gi, "url([omitted])");
    }
    return result;
  }

  function cssVariables(style) {
    const variables = {};
    for (let index = 0; index < style.length; index += 1) {
      const name = style[index];
      if (!name?.startsWith("--") || SENSITIVE_NAME.test(name)) continue;
      const value = compactText(style.getPropertyValue(name), 160).replace(
        /url\([^)]*\)/gi,
        "url([omitted])",
      );
      if (value) variables[name] = value;
      if (Object.keys(variables).length >= 40) break;
    }
    return variables;
  }

  function sanitizeHtml(element) {
    const clone = element.cloneNode(true);
    clone
      .querySelectorAll?.("script, style, noscript, iframe")
      .forEach((node) => node.remove());
    for (const node of [clone, ...(clone.querySelectorAll?.("*") || [])]) {
      for (const attribute of [...node.attributes]) {
        const value = sanitizeAttribute(attribute.name, attribute.value);
        if (value === null) node.removeAttribute(attribute.name);
        else if (value !== attribute.value) node.setAttribute(attribute.name, value);
      }
    }
    const html = clone.outerHTML.replace(/\s+/g, " ").trim();
    return html.length > 2400 ? `${html.slice(0, 2397)}...` : html;
  }

  function boundsFor(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      pageX: Math.round(rect.left + window.scrollX),
      pageY: Math.round(rect.top + window.scrollY),
    };
  }

  function compactElement(element) {
    const accessibility = getAccessibility(element);
    return {
      selector: generateSelector(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: [...element.classList].slice(0, 12),
      text: compactText(element.innerText || element.textContent, 160),
      role: accessibility.role,
      name: accessibility.name,
    };
  }

  function capture(element, { debug = false } = {}) {
    const style = getComputedStyle(element);
    const accessibility = getAccessibility(element);
    return {
      schema: "doppie-assist/dev-context-v1",
      selector: {
        primary: generateSelector(element),
        alternatives: selectorCandidates(element).slice(1),
      },
      element: {
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        classes: [...element.classList].slice(0, 20),
        text: compactText(element.innerText || element.textContent),
        attributes: getAttributes(element),
        html: sanitizeHtml(element),
      },
      bounds: boundsFor(element),
      boxModel: getBoxModel(element, style),
      styles: {
        key: styleSnapshot(style, KEY_STYLE_PROPERTIES),
        ...(debug
          ? {
              computed: styleSnapshot(style, DEBUG_STYLE_PROPERTIES),
              variables: cssVariables(style),
            }
          : {}),
      },
      accessibility,
      ancestry: debug
        ? [element.parentElement, element.parentElement?.parentElement]
            .filter(Boolean)
            .map(compactElement)
        : [],
      fingerprint: {
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        classes: [...element.classList].slice(0, 6),
        text: compactText(element.innerText || element.textContent, 120),
        role: accessibility.role,
        name: accessibility.name,
      },
    };
  }

  function resolve(context, root = document) {
    const selectors = [
      context?.selector?.primary,
      ...(context?.selector?.alternatives || []),
    ].filter(Boolean);
    for (const selector of selectors) {
      const element = queryOne(selector, root);
      if (element) return element;
    }
    return null;
  }

  globalThis.DoppieDevContext = {
    capture,
    generateSelector,
    resolve,
    sanitizeHtml,
  };
})();
