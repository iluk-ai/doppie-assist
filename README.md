# Doppie Assist

Doppie Assist is a Manifest V3 browser extension for capturing a precise region or reviewing multiple page elements, adding visual feedback, and creating Linear issues with source context.

Its interface follows the Dopamina product system: Outfit and DM Serif Display typography, ink borders, hard offset shadows, purple actions, lime focus states, and coral annotation accents.

The 440 px popup keeps the full issue composer visible within Chrome's 600 px popup height, without requiring vertical scrolling.

## Download

Download the latest packaged extension from [GitHub Releases](https://github.com/iluk-ai/doppie-assist/releases/latest). Unzip the archive before loading it into Chrome.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Pin Doppie Assist to the browser toolbar.

Refresh any tab that was open before installation so the capture script can run on it. Browser-internal pages such as `chrome://settings` cannot be captured by extensions.

On first open, Doppie Assist shows the Linear connection screen. Connect with OAuth or a personal API key to enter the issue composer. Disconnecting returns the popup to this login screen.

## Capture workflow

1. Open Doppie Assist and choose **Region** to drag and mark up a freeform area, or **Review** to annotate multiple DOM elements directly on the page.
2. In Review mode, click an element, describe the requested change in the anchored popover, and add as many numbered annotations as needed. The selected element remains locked and outlined until the note is saved or canceled. Use the parent/child buttons or `Alt` + scroll to move through the element ancestry without dismissing the note.
3. Optionally choose **Record flow** and reproduce the behavior on the live page. Doppie Assist records up to 20 click, input, and navigation steps, screenshots for the first six steps, and up to 90 seconds of tab video without audio. Stop the recording to preview the WebM in **Captured context**. A recorded flow can be submitted as its own Linear issue without adding an element annotation.
4. Choose **Element**, **Viewport**, or **None** for each annotation's screenshot evidence. Element captures include surrounding context, while viewport captures mark the selected element in the full visible page.
5. Choose **Review issues** to see each note with its screenshot thumbnail. Select a thumbnail to return to the live element, or edit the item inline to refine its feedback type, screenshot mode, issue title, request, team, priority, assignee, project, and labels. Items use the shared review routing by default.
6. Optionally enable **Group under parent issue** to create one page-review summary with every annotation linked as a child issue.
7. Doppie Assist creates one Linear issue per annotation, or one standalone reproduction issue when the review only contains a recorded flow, and copies the created Linear links to the clipboard. A failed item remains editable and can be retried without interrupting or duplicating successful issues.

Captures and drafts are stored in `chrome.storage.local` and retained in the browser profile. An active review is autosaved after every meaningful change and can be restored on the same site for up to eight hours. Recording continues across navigation in the same tab and the review bar reconnects to the offscreen recorder on the next page. Closing or canceling Review mode stops the capture.

The inline annotation editor uses a compact rounded surface with a persistent target outline, focused writing area, and consistent actions across the note editor, Page review panel, and session bar. The review interface returns as soon as the browser capture finishes, before image cropping, so adding another annotation feels continuous.

Issue fields and review routing use consistent Lucide-style icons for faster scanning. Feedback templates for Bug, UI change, Copy, Accessibility, and Behavior add focused acceptance criteria to each issue.

While Review mode is active, Doppie Assist captures console warnings and errors, unhandled runtime failures, navigation and interaction events, and a bounded network timeline. The timeline includes successful and failed `fetch`/XHR requests plus static resource timing, with method, status, duration, content type, transfer size, and sanitized URL when available. Query values and URL fragments in captured activity are redacted. Request and response bodies, request headers, arbitrary response headers, credentials, form values, microphone audio, and system audio are never recorded. Reproduction, video, network, session events, and diagnostics are visible under **Captured context** before submission.

For a flow-only review, **Review flow** opens an editable Linear composer with issue title, feedback type, summary, routing, captured context, and screenshot evidence. These fields are included in the review autosave and survive reloads.

## Keyboard shortcuts

- `Command+Shift+1` on macOS or `Ctrl+Shift+1` elsewhere starts a region capture.
- `Command+Shift+2` on macOS or `Ctrl+Shift+2` elsewhere starts multi-element Review mode.
- `Command+Enter` on macOS or `Ctrl+Enter` elsewhere saves the annotation currently open in Review mode.

Chrome may leave a suggested shortcut unassigned when it conflicts with another extension or system command. Choose **Edit shortcuts** in Doppie Assist settings to open Chrome's extension shortcut page, where Chrome allows these keys to be changed. Extensions cannot remap their own global shortcuts programmatically.

## Connect Linear

Open the connection settings from the gear button and choose **Connect to Linear**. Doppie Assist requests the `read`, `write`, and `issues:create` scopes using Linear OAuth with Authorization Code and PKCE, refreshes expiring access tokens automatically, and revokes the refresh token when you disconnect. No client secret or backend is required for this local extension build.

The OAuth Client ID is already included. Register this exact callback URL in the Linear OAuth application before connecting:

```text
https://ifchfjlgbdafpbfofmkpnackdmjoblmn.chromiumapp.org/linear
```

The extension's manifest contains a stable public key so an unpacked installation keeps the Chrome extension ID `ifchfjlgbdafpbfofmkpnackdmjoblmn`. Do not remove or replace the manifest `key`, because doing so changes the callback URL. The private key used to derive this identity is intentionally kept outside the extension and its packages.

For manual or offline setup, expand **Use a personal API key**. Both connection methods validate access and load teams, active members, projects, and labels. The issue composer supports team, assignee, project, multiple labels, and priority. Before `issueCreate`, each capture and recorded WebM is uploaded through Linear's signed `fileUpload` flow and its compact private asset URL is added to the Markdown description. Keeping base64 evidence out of `IssueCreateInput` prevents large captures and multi-issue batches from triggering argument validation errors.

Linear descriptions are formatted for both people and coding agents. They include the requested change, feedback type, page title, complete URL and URL path, target selectors, visible element text, sanitized HTML, element and viewport geometry, accessibility metadata, box model, computed styles, CSS variables, ancestry and parent layout, reproduction steps, network activity, session events, diagnostics, acceptance checks, screenshot evidence, and a stable `doppie-assist/v3` JSON context block. Embedded form values, inline event handlers, scripts, styles, credentials, and embedded data URLs are removed from captured HTML.

OAuth tokens or the optional API key are stored locally in the browser profile. Connection metadata exposed to the popup and page review does not include those credentials.

## Automatic developer context and Codex skill

Doppie Assist can hand a browser review directly to a coding agent without creating Linear issues. The connection is manual and local: the skill opens a one-use listener on `127.0.0.1:47361`, the extension shows **Agent connected**, and no review data is sent until you choose **Send to coding agent**.

After invocation, the skill keeps the listener running without asking for confirmation. Submission from the extension resumes the same agent turn automatically; a new prompt is only needed when the user explicitly cancels or the listener times out.

Install the bundled skill in your Codex skill directory:

```bash
cp -R skills/doppie-assist "${CODEX_HOME:-$HOME/.codex}/skills/doppie-assist"
```

Then invoke it from a Codex terminal prompt:

```text
$doppie-assist
```

Codex skills use the `$skill-name` invocation syntax, so `$doppie-assist` is the supported equivalent of a `/doppie-assist` command. The skill waits up to 30 minutes for one review, writes its JSON, Markdown brief, screenshots, and optional flow video under the operating-system temporary directory, then maps the rendered selectors and developer context back to the current codebase.

Developer context is always automatic. Every element annotation includes alternate selectors, accessibility role and name, box model, key styles, CSS variables, and nearby ancestors. **Agent connected** appears when the local listener is ready, but there is no mode toggle to manage.

## Updates

Doppie Assist checks the latest GitHub Release when installed or started and then every six hours in the background. When a newer browser-extension package is available, the toolbar icon shows an **UP** badge, while settings and the login screen show **Download vX.Y.Z**. The button downloads the exact versioned ZIP from `iluk-ai/doppie-assist` and then shows the local-install steps: unzip the package, replace the currently loaded extension folder, and click **Reload** in `chrome://extensions`.

Chrome does not allow an unpacked extension to replace its own files on macOS or Windows, so the final folder replacement remains manual. The update checker validates the GitHub repository and release-download path before starting the download.

## Permissions

- `activeTab` and `scripting`: start capture on the current page.
- `storage` and `unlimitedStorage`: retain annotated JPEG captures and drafts.
- `clipboardWrite`: copy created Linear issue links immediately after creation.
- `identity`: open Linear's OAuth consent flow and return to the extension callback.
- `downloads`: save a selected update package from GitHub Releases.
- `alarms`: check GitHub Releases periodically while Chrome is running.
- `tabCapture`: record the reviewed browser tab after **Record flow** is pressed.
- `offscreen`: keep the video encoder running in a hidden extension document while the review remains on the page.
- `https://api.linear.app/*`: validate a Linear connection, request screenshot uploads, and create issues.
- `https://uploads.linear.app/*`: upload screenshots and recorded flow videos to Linear's signed private storage URL.
- `https://api.github.com/repos/iluk-ai/doppie-assist/*`: check the latest published version.
- `https://github.com/iluk-ai/doppie-assist/releases/download/*`: download the selected extension ZIP.
- `http://127.0.0.1:47361/*`: detect and submit to the one-use local Codex skill listener.

## Attribution

The developer inspection workflow adopts interaction ideas from [`pi-annotate`](https://github.com/nicobailon/pi-annotate). See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the MIT license notice.
