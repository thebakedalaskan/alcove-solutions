# Floating call

The floating call is a second presentation of the running call, populated through a React portal into a Document
Picture-in-Picture window. The main app remains the call owner. It does not create another `CallSession`, `LocalMedia`,
LiveKit connection, notes recorder or capture pipeline. Closing the main app follows its existing leave/reconnect behavior;
the floating window cannot carry on as an independent client.

## State, media and controls

The compact presentation consumes the current call/media/encryption snapshots and the same microphone, camera, hand and
departure actions as the main view. Pending and failed actions remain visible. Hand changes are awaitable through the
existing client action, so returning successfully means the new hand state has been read, rather than merely requested.
No wire shape, database schema or sealed record format changes.

Camera and screen pictures use the existing allowed feeds through `FeedVideo`, whose video elements are muted. Existing
`CallRoom` audio elements remain the only voice/screen-audio playback endpoints, preserving output-device and volume choices.
Selection follows the current room's permitted participants and shares. A vanished speaker/share falls back to a permitted
speaker or an empty/avatar state. The compact view does not mount another zoom/history `ShareSurface` for the same share.

The floating call and the existing share pop-out coordinate their use of the browser's PiP window. Automatic opening must
not replace a share the person explicitly popped out. Child-window closure only disposes its presentation; it does not
stop tracks, flush capture or leave the room. Explicit Leave uses the existing confirmation, flush, handoff and rollback
flow. Reconnect preserves the compact view; termination, removal, device displacement and main-view teardown close it.
A late browser-window request cannot revive a departed call.

The compact view shows hands, open Q&A, host-only admission requests and a count labelled Chat for new messages. Each
count returns to its matching full-call panel. Shared controls unlock the existing sound output synchronously from
their user gesture; microphone confirmation still waits for the actual device transition. It does not show message
bodies or personal notes. The full call supports individual @mentions in room chat, an unread-mention indicator and
navigation to the exact message; viewing that message updates the person's read state. Those receipts are kept in the
sealed call state across refreshes and reconnects. The compact window uses the generic Chat count, including unread
mentions, and leaves exact-message navigation and reading to the full call. Workspace document tags remain a separate feature.

## Browser capability and automatic opening

Detect Document PiP and Media Session actions separately at runtime; do not select support by browser name alone.

| Desktop browser | Document PiP capability | Automatic PiP action capability |
| --- | --- | --- |
| Chrome / Edge 116+ | Manual window with custom controls | Conferencing action from 120, subject to current browser eligibility and permission |
| Firefox 151+ | Manual window with custom controls | Corresponding Media Session action unsupported in current compatibility data |
| Safari | Document PiP unsupported | Unavailable for this feature |

These are documented API capabilities, not a claim that every version/platform has been exercised in Alcove. Mobile is
outside this desktop feature. An ordinary popup does not provide the same always-on-top guarantee; normal meeting
controls remain available when Document PiP is absent or blocked.

View shows a visible unsupported-browser explanation connected to the unavailable action with `aria-describedby`.
A refused manual opening keeps View open, announces the failure and explains how to check the site's picture-in-picture
permission before trying the same action again. View closes only once the floating window exists, so a refused keyboard
action does not lose its recovery controls or focus. Neither failure retries an opening automatically.

Automatic opening is the normal call behavior where the browser permits it. There is no Alcove automatic-opening
preference or explanatory control in View: the browser owns its permission and may ask when the person first switches
tabs. View retains the manual opening action and any opening failure. The browser triggers `enterpictureinpicture`;
arbitrary `blur` or `visibilitychange` does not open a window. Visibility is used for returning an automatically opened
presentation, not for gaining permission to open one.

The former browser-local `autoFloat` field is no longer part of `CallViewPrefsSchema`. The schema ignores that old field
while preserving mode, self-view and corner; the next normal preference save writes the current shape without it.
Browser automatic-PiP permission remains the choice that controls opening. No database migration or sealed-record
upgrade is needed.

Chrome's conferencing eligibility path requires an HTTPS origin, existing live camera or microphone capture and browser
permission. A muted microphone whose capture track is still live remains eligible; the app must not confuse mute with
stopped capture. A call with no live capture uses manual opening. HTTP localhost supports manual Document PiP but does not
qualify for Chrome's automatic path. No new `getUserMedia` or `getDisplayMedia` request
is made for eligibility. The PiP action owns only its own handler: existing shared-video play/pause handlers and media
metadata continue to belong to playback. Modern action details call the reason `enterPictureInPictureReason`, with
`useraction` and `contentoccluded`; older browsers may omit it. Failed or denied automatic opening must not repeatedly
prompt or take focus.

Switching tabs and minimizing Chrome are different browser triggers. Chrome's current native behavior does not guarantee
opening a closed PiP window on minimization or when another desktop app takes focus. Open the floating call manually
before minimizing when needed; an already-open window can remain over other apps. Do not add a blur-triggered request to
work around the browser's permission and user-gesture rules.

Sources: [Document PiP](https://developer.chrome.com/docs/web-platform/document-picture-in-picture),
[conferencing automatic PiP](https://developer.chrome.com/blog/automatic-picture-in-picture),
[Firefox 151](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/151#apis),
[Document PiP compatibility](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/DocumentPictureInPicture.json),
[Media Session compatibility](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/MediaSession.json),
[Media Session action details](https://www.w3.org/TR/mediasession/#the-mediasessionactiondetails-dictionary),
[Chromium automatic PiP eligibility and window visibility](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/picture_in_picture/auto_picture_in_picture_tab_helper.cc).

## Privacy and verification

Do not assume a PiP window is excluded from screen recording or sharing. Behavior depends on browser, capture source and
operating system; verify what another participant actually receives. Keep private notes/message text absent regardless.
Do not place call content in new window URLs, logs or platform media metadata.

Storybook shows compact states and the real call entry point. Manual Document PiP opening requires a genuine user gesture
and a top-level document; an iframe journey or simulated click cannot establish native-browser coverage. API integration tests exercise
actual multi-client control states and rejection, admission, host controls, reconnect, handoff and departure. They do not
prove browser capture flushing or window focus.

The story browser normally returns the real Document PiP API unchanged. Explicit unsupported/refused scenarios instead
hide that capability or reject opening without creating a window. Their light/dark, wide/phone states and refusal/retry
journey demonstrate accessible fallback and continued calling; they do not claim native permission or capture coverage.

Release verification records actual platform/version and results for manual opening/refusal, browser automatic-PiP
permission, tab/window/app switches, resizing, repeated close/open, return focus, device errors, host mute, room changes,
screen sharing, reconnect, removal, failed Leave and normal termination. Check one participant identity, one audio playback
endpoint per track and one capture owner. Distinguish unexercised combinations from passes.

### Verified on 8 November 2026

Native Chrome 156 on macOS 27.2, using the real local API, Postgres, object store and LiveKit, with made-up participants:

- Two participants remained two when the floating window opened; raised-hand changes reached the other participant.
- Incoming hands and chat produced compact counts without message bodies. Chat's attention action returned to the full
  meeting and opened Chat. The originating View menu closed when the window opened.
- Repeated manual opening, Return, native child-window close, Leave's inline question and Stay were exercised. Native
  close retained the call and device/hand choices; Stay restored focus to Leave inside the child.
- Camera/microphone permission denial produced compact device feedback. Devices and notes stayed off throughout this run.
- Stopping the isolated API made Leave fail visibly inside the still-open child. After the API restarted, Stay and a
  confirmed raised-hand action worked. Normal ending closed the child and reached the other participant.
- Component previews were checked in both themes at 280 × 380 and 400 × 420.

In a separate production HTTPS check on Chrome 156/macOS 27.2, the person running the call confirmed automatic floating
opening after leaving the tab. The microphone was muted, camera off and notes off. This is user-observed automatic-opening
evidence, separate from the local scripted-service checks above.

These checks do **not** verify audible output/recording, the native automatic-PiP permission prompt, native resizing,
minimization or desktop-app switching, screen-capture inclusion/exclusion, share arbitration across rooms, or
Edge/Firefox/Safari/Windows behavior. They do not establish automatic-return focus or capture privacy from the production
observation alone. Their capability descriptions and source/integration coverage are separate from this native-browser
evidence. The regression flow for a failed HTTP departure separately verifies continued incoming MLS chat, hand refresh
and a successful retry over real services; it does not establish browser recorder flush/rollback.
