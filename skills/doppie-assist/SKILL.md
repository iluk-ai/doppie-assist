---
name: doppie-assist
description: Wait for a Doppie Assist browser review and implement its element-level annotations in the current codebase. Use when the user asks to receive, apply, or work through Doppie Assist developer annotations.
---

# Doppie Assist

Receive one browser review through the bundled loopback listener, then treat its
annotations as the user's requested code changes.

## Workflow

1. Run the listener and wait for the browser submission:

   ```bash
   node <skill-directory>/scripts/wait-for-annotations.cjs --timeout 1800000
   ```

   Use the actual installed skill directory for `<skill-directory>`. Keep the
   command running until it prints `DOPPIE_ASSIST_RESULT`, times out, or the user
   cancels it. Do not start a second listener on the same port.

2. Ask the user to open Doppie Assist, start **Review**, add annotations, open
   **Review issues**, and choose **Send to coding agent** only when the listener
   is waiting and the user has not already started the browser review.

3. Read the `bundlePath` and `briefPath` returned in
   `DOPPIE_ASSIST_RESULT`. Inspect referenced screenshots when visual evidence
   affects the requested change.

4. Match each annotation to the current codebase using its URL path, selectors,
   visible text, sanitized HTML, accessibility data, box model, styles, and
   parent context. Browser selectors identify rendered output; do not assume
   they are source-code selectors.

5. Implement every annotation that can be resolved, preserving existing project
   conventions. Verify the affected behavior and report any annotation that
   cannot be mapped confidently.

The listener accepts one submission from the fixed Doppie Assist extension,
writes its files under the operating-system temporary directory, and exits. It
does not create Linear issues or keep a persistent service running.
