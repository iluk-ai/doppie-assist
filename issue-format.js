(() => {
  const FEEDBACK_TYPES = {
    bug: {
      label: "Bug",
      criteria: [
        "Reproduce the reported behavior before applying the fix.",
        "Fix the underlying cause and add regression coverage where practical.",
      ],
    },
    ui: {
      label: "UI change",
      criteria: [
        "Match the requested visual change across relevant viewport sizes.",
        "Preserve existing interactions and design-system conventions.",
      ],
    },
    copy: {
      label: "Copy",
      criteria: [
        "Update the specified copy without changing unrelated content.",
        "Preserve localization, formatting, and accessibility behavior.",
      ],
    },
    accessibility: {
      label: "Accessibility",
      criteria: [
        "Verify keyboard and assistive-technology behavior for the target.",
        "Meet the product's applicable WCAG requirements.",
      ],
    },
    behavior: {
      label: "Behavior",
      criteria: [
        "Implement the requested interaction and verify relevant edge cases.",
        "Preserve unrelated behavior and surrounding state transitions.",
      ],
    },
  };

  const clean = (value = "") => String(value).replace(/\s+/g, " ").trim();

  const markdownText = (value = "") =>
    clean(value).replace(/[\\[*_~]/g, "\\$&");

  const inlineCode = (value = "") => clean(value).replaceAll("`", "");

  const pagePath = (url = "") => {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
    } catch (_) {
      return url || "Unknown";
    }
  };

  const quoteText = (value = "") =>
    String(value)
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

  const compactObject = (value) =>
    Object.fromEntries(
      Object.entries(value).filter(
        ([, item]) =>
          item !== undefined && item !== null && item !== "" && item !== false,
      ),
    );

  const compactSteps = (steps = []) =>
    steps.slice(0, 20).map((step, index) =>
      compactObject({
        number: index + 1,
        action: clean(step.action),
        selector: step.selector,
        url: step.url,
      }),
    );

  const compactDiagnostics = (diagnostics = []) =>
    diagnostics.slice(-20).map((item) =>
      compactObject({
        type: item.type,
        message: clean(item.message).slice(0, 500),
        url: item.url,
        status: item.status,
        method: item.method,
      }),
    );

  const edgeValues = (edges = {}) =>
    [edges.top, edges.right, edges.bottom, edges.left]
      .map((value) => Number(value || 0))
      .join(" ");

  const developerSummary = (developerContext) => {
    if (!developerContext) return "";
    const lines = [];
    const accessibility = developerContext.accessibility || {};
    const boxModel = developerContext.boxModel || {};
    const styles = developerContext.styles?.key || {};
    if (accessibility.role || accessibility.name)
      lines.push(
        `- **Accessibility:** role \`${inlineCode(accessibility.role || "none")}\`${
          accessibility.name
            ? `, name “${markdownText(accessibility.name)}”`
            : ""
        }, ${accessibility.focusable ? "focusable" : "not focusable"}`,
      );
    if (boxModel.content)
      lines.push(
        `- **Box model:** content ${boxModel.content.width} x ${boxModel.content.height}px; padding \`${edgeValues(
          boxModel.padding,
        )}\`; border \`${edgeValues(boxModel.border)}\`; margin \`${edgeValues(
          boxModel.margin,
        )}\``,
      );
    const styleSummary = [
      "display",
      "position",
      "z-index",
      "width",
      "height",
      "gap",
      "font-size",
      "font-weight",
      "color",
      "background-color",
    ]
      .filter((property) => styles[property])
      .map((property) => `${property}: ${styles[property]}`)
      .join("; ");
    if (styleSummary)
      lines.push(`- **Key styles:** \`${inlineCode(styleSummary)}\``);
    return lines.join("\n");
  };

  function buildIssueDescription(context = {}) {
    const request = String(context.request || context.issueTitle || "").trim();
    const url = context.url || "";
    const path = pagePath(url);
    const pageTitle = markdownText(context.pageTitle || "Current page");
    const feedbackType =
      FEEDBACK_TYPES[context.feedbackType] || FEEDBACK_TYPES.ui;
    const reproductionSteps = compactSteps(context.reproductionSteps);
    const diagnostics = compactDiagnostics(context.diagnostics);
    const developerContext = context.developerContext || null;
    const target = compactObject({
      mode: context.mode || "page",
      label: context.label,
      selector: context.selector,
      tag: context.tagName,
      text: context.elementText,
      html: context.elementHtml,
      bounds: context.bounds,
      viewport: context.viewport,
    });
    const capture = compactObject({
      mode: context.screenshotMode,
      width: context.captureWidth,
      height: context.captureHeight,
      format: context.captureFormat || (context.screenshot ? "image/jpeg" : ""),
    });
    const agentContext = {
      schema: "doppie-assist/v2",
      request,
      feedbackType: feedbackType.label,
      page: compactObject({ title: context.pageTitle, url, path }),
      target,
      developerContext,
      capture,
      reproductionSteps,
      diagnostics,
    };
    const targetLines = [
      `- **Feedback type:** ${feedbackType.label}`,
      `- **Page:** ${pageTitle}`,
    ];
    if (url) targetLines.push(`- **URL:** <${url}>`);
    if (path) targetLines.push(`- **URL path:** \`${inlineCode(path)}\``);
    if (context.label)
      targetLines.push(`- **Element:** \`${inlineCode(context.label)}\``);
    if (context.selector)
      targetLines.push(`- **Selector:** \`${inlineCode(context.selector)}\``);
    if (context.bounds)
      targetLines.push(
        `- **Bounds:** x ${context.bounds.x}, y ${context.bounds.y}, ${context.bounds.width} x ${context.bounds.height}px`,
      );
    if (context.viewport)
      targetLines.push(
        `- **Viewport:** ${context.viewport.width} x ${context.viewport.height}px @ ${context.viewport.devicePixelRatio || 1}x`,
      );
    if (context.captureWidth && context.captureHeight)
      targetLines.push(
        `- **Capture:** ${context.captureWidth} x ${context.captureHeight}px`,
      );

    const sections = [
      `## Requested change\n${request || "Review the captured target and apply the requested update."}`,
      `## Target\n${targetLines.join("\n")}`,
    ];

    if (context.elementText || context.elementHtml) {
      const elementParts = [];
      if (context.elementText)
        elementParts.push(
          `**Visible text**\n${quoteText(context.elementText)}`,
        );
      if (context.elementHtml)
        elementParts.push(
          `**Sanitized HTML**\n\n\`\`\`html\n${String(context.elementHtml).replaceAll("```", "&#96;&#96;&#96;")}\n\`\`\``,
        );
      sections.push(`## Element context\n${elementParts.join("\n\n")}`);
    }

    const devSummary = developerSummary(developerContext);
    if (devSummary) sections.push(`## Developer context\n${devSummary}`);

    if (reproductionSteps.length)
      sections.push(
        `## Reproduction steps\n${reproductionSteps
          .map(
            (step) =>
              `${step.number}. ${step.action}${step.selector ? ` - \`${inlineCode(step.selector)}\`` : ""}`,
          )
          .join("\n")}`,
      );

    if (diagnostics.length)
      sections.push(
        `## Diagnostics\n\`\`\`text\n${diagnostics
          .map((item) => {
            const prefix = [item.type, item.method, item.status]
              .filter(Boolean)
              .join(" · ");
            return `${prefix ? `[${prefix}] ` : ""}${item.message}${item.url ? ` - ${item.url}` : ""}`;
          })
          .join("\n")}\n\`\`\``,
      );

    sections.push(
      `## Acceptance criteria\n${[
        "Apply the requested change to the identified target.",
        ...feedbackType.criteria,
        `Verify the result at \`${inlineCode(path)}\`.`,
      ]
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );

    if (context.screenshot)
      sections.push(
        `## Evidence\n![Annotated screenshot from Doppie Assist](${context.screenshot})`,
      );

    sections.push(
      `## Agent context\n\`\`\`json\n${JSON.stringify(agentContext, null, 2)}\n\`\`\``,
    );
    return sections.join("\n\n");
  }

  function buildReviewDescription(context = {}) {
    const annotations = context.annotations || [];
    const description = buildIssueDescription({
      issueTitle: context.title,
      request: `Coordinate this page review containing ${annotations.length} annotated ${annotations.length === 1 ? "change" : "changes"}.`,
      pageTitle: context.pageTitle,
      url: context.url,
      feedbackType: "ui",
      reproductionSteps: context.reproductionSteps,
      diagnostics: context.diagnostics,
    });
    const childPlan = annotations.length
      ? annotations
          .map(
            (annotation, index) =>
              `${index + 1}. **${markdownText(annotation.title)}** - ${FEEDBACK_TYPES[annotation.feedbackType]?.label || FEEDBACK_TYPES.ui.label} - \`${inlineCode(annotation.selector || annotation.label)}\``,
          )
          .join("\n")
      : "No child annotations.";
    return `${description}\n\n## Planned child issues\n${childPlan}`;
  }

  globalThis.DoppieIssueFormat = {
    FEEDBACK_TYPES,
    buildIssueDescription,
    buildReviewDescription,
    pagePath,
  };
})();
