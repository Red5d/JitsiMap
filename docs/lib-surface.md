# lib-jitsi-meet surface verification (SPEC §6.1 — Milestone 0 gate)

## Pin block

| Item | Value |
|---|---|
| lib-jitsi-meet | **v2236.0.0+51058e35** (`vendor/lib-jitsi-meet.tgz`, installed at `node_modules/lib-jitsi-meet`) |
| sha256 (lib tgz) | `da17ece512ff383556e7b91e5a3723dd250f952590f4c199224a0cb378946014` |
| Vendored strophe.js | **1.5.0 jitsi-3** (`vendor/strophe.js-1.5.0.tgz`, npm `overrides` → `file:vendor/strophe.js-1.5.0.tgz`) |
| sha256 (strophe tgz) | `e513885e0a74cec88f8df6b8b295572c87a4875f9d5d74ea8c7dd18e75a52b46` |
| Verified | 2026-10-29, against `node_modules/lib-jitsi-meet/dist/esm/**` (source file paths cited below). UMD bundle: `dist/umd/lib-jitsi-meet.min.js` (browser-only). |
| Types | The package ships **no consumable types** (`package.json` has no `types` field; `types/index.d.ts` is a typedoc bundle of non-relative ambient module declarations). The shim `src/jitsi/types.d.ts` is written from the verified surface. |
| License | Apache-2.0 |

All paths below are relative to `node_modules/lib-jitsi-meet/dist/esm/`.

## 1. `JitsiMeetJS.init(options)` — `JitsiMeetJS.js`

`init(options = {}): void`. Verified consumed options (from `init` body + `Statistics.init` in `modules/statistics/statistics.js` + `RTC.init` → `modules/RTC/RTCUtils.js`):

- `enableAnalyticsLogging?: boolean` — **must be `true` to keep analytics alive**; otherwise `init` disposes `JitsiMeetJS.analytics` (JitsiMeetJS.js:279). Default off = analytics disabled.
- `disableThirdPartyRequests?: boolean`, `disableAudioLevels?: boolean`, `pcStatsInterval?: number`, `audioLevelsInterval?: number` (statistics.js:35-46).
- `externalStorage` — passed to `Settings.init` (localStorage-shaped).
- `rtcstatsStoreLogs?: boolean`, `rtcstatsLogFlushSizeBytes?: number` — rtcstats log transport.
- `analytics` — passed through to WatchRTC init; no `disabled` sub-flag exists (the legacy `analytics.disabled` flow is gone).

Feature-disabling: no per-feature `init` flags; features are disabled via `flags` (connection options, `FeatureFlags.init`) and conference config. For JitsiMap we pass analytics-off by default (simply omit `enableAnalyticsLogging`).

**Log level API**: `JitsiMeetJS.setLogLevel(level: string)`, `setLogLevelById(level, id)`, `setGlobalLogOptions(options)`, `JitsiMeetJS.logLevels` = `Logger.levels` from `@jitsi/logger` 2.1.1 (`trace|debug|info|log|warn|error`; default INFO set at module load, JitsiMeetJS.js:41).

## 2. `JitsiConnection` — `JitsiConnection.js`

`new JitsiConnection(appID: string|null, token: string|null, options)`; also exposed as `JitsiMeetJS.JitsiConnection`. Methods: `connect(options?: {id?, password?, name?})`, `disconnect(): Promise<void>`, `initJitsiConference(name, options)`, `addEventListener(event, listener)`, `removeEventListener(event, listener)`, `getJid()`, `refreshToken(token)`, `addFeature/removeFeature`.

Options shape (`modules/xmpp/xmpp.js` constructor, ~line 134):

- `hosts: { domain, muc, focus?, anonymousdomain?, ... }` — `domain` required (ping target, xmpp.js:154), `muc` used for room JIDs (xmpp.js:866), `anonymousdomain` for anonymous login (xmpp.js:814).
- **`serviceUrl: string` — REQUIRED.** ⚠️ **Divergence from SPEC §6.2:** `bosh` is **removed**; the constructor *throws* `'The "bosh" option is no longer supported, please use "serviceUrl" instead'` (xmpp.js:134). The spec's `{hosts, bosh, websocket}` maps to `{hosts, serviceUrl: <xmpp-websocket url>}`. Runtime config keeps both env keys (§13) but the adapter passes `serviceUrl = jitsi.websocket`; BOSH is not usable in this pin.
- `enableWebsocketResume?: boolean`, `websocketKeepAlive?`, `websocketKeepAliveUrl?`, `xmppPing?: {domain}`, `p2pStunServers?`, `bridgeChannel?: {ignoreDomain?, preferSctp?}`, `disableFocus?`, `deploymentInfo?: {userRegion?, shard?}`, `flags?`, `audioTranslation?: {enabled}`.

`JitsiConnectionEvents` constant **values** (JitsiConnectionEvents.js):

| Constant | Value |
|---|---|
| CONNECTION_DISCONNECTED | `connection.connectionDisconnected` |
| CONNECTION_ESTABLISHED | `connection.connectionEstablished` (listener arg: local endpoint id) |
| CONNECTION_FAILED | `connection.connectionFailed` (`errType, msg, credentials, details`) |
| CONNECTION_REDIRECTED | `connection.redirected` |
| CONNECTION_TOKEN_EXPIRED | `connection.token_expired` |
| DISPLAY_NAME_REQUIRED | `connection.display_name_required` |
| PROPERTIES_UPDATED | `connection.propertiesUpdated` |

⚠️ There is **no `CONNECTION_INTERRUPTED` connection event** — interruption/restoration are *conference* events (`conference.connectionInterrupted` / `conference.connectionRestored`). "Interrupted/disconnected" from SPEC §6.1 item 2 maps accordingly.

## 3. `connection.initJitsiConference(roomName, confOptions)` — `JitsiConnection.js:113`

Returns a `JitsiConference`; `confOptions` is the lib's `options.config` (constructor JSDoc JitsiConference.js:100-127, `IConferenceOptions.config` in the typedoc bundle, `_init` JitsiConference.js:353). Verified fields:

- `p2p: { enabled?, backToP2PDelay?, preferredCodec?, screenshareCodec?, codecPreferenceOrder?, disabledCodec? }`
- `videoQuality: { codecPreferenceOrder?, disabledCodec?, enableAdaptiveMode?, preferredCodec?, screenshareCodec?, mobile* }`
- `channelLastN?: number` (default -1), `startLastN?: number`
- `startAudioMuted?: number`, `startVideoMuted?: number` (participant-count thresholds), `startSilent?: boolean`
- `enableNoAudioDetection?`, `enableNoisyMicDetection?`, `enableTalkWhileMuted?`, `disableAudioLevels?`, `disableLocalStats?`, `pcStatsInterval?`, `e2eping?: {enabled}`, `enableIceRestart?`
- `testing: { allowMultipleTracks?, enableFirefoxP2p?, lastNRampupTime?, p2pTestMode?, enableGracefulReconnect? }` — there is **no `enableWebRTCStats`** key; rtcstats is configured via `analytics.rtcstatsEnabled`/`rtcstatsEndpoint` (connection `init` / `joinConference` defaults, JitsiMeetJS.js) — not needed by SPEC.
- `deploymentInfo?: {userRegion}`, `statisticsId?`, `statisticsDisplayName?`, `applicationName?`, `audioTranslation?: {enabled}`, `confID?`, `hiddenDomain?`, `createVADProcessor?`, `avgRtpStatsN?`

`JitsiConferenceEvents` **values** (JitsiConferenceEvents.js) — the §6.3 set:

| Constant | Value | Verified listener args (emit site) |
|---|---|---|
| CONFERENCE_JOINED | `conference.joined` | () — JitsiConferenceEventManager.js:103 |
| CONFERENCE_LEFT | `conference.left` | () —EventManager:192 |
| CONFERENCE_FAILED | `conference.failed` | (error: JitsiConferenceErrors, ...params) — EventManager:132-151 |
| CONFERENCE_JOIN_IN_PROGRESS | `conference.join_in_progress` | () |
| CONNECTION_INTERRUPTED / RESTORED | `conference.connectionInterrupted` / `conference.connectionRestored` | () |
| DATA_CHANNEL_OPENED | `conference.dataChannelOpened` | () — EventManager:321 (exact name confirmed) |
| DATA_CHANNEL_CLOSED | `conference.dataChannelClosed` | () |
| USER_JOINED | `conference.userJoined` | **(id, participant)** — JitsiConference.js onMemberJoined → emit ~3120 |
| USER_LEFT | `conference.userLeft` | **(id, participant?, reason?)** — JitsiConference.js:3181 |
| USER_ROLE_CHANGED | `conference.roleChanged` | (id, role) |
| DISPLAY_NAME_CHANGED | `conference.displayNameChanged` | (id, displayName) — JitsiConference.js:3259-3270 |
| TRACK_ADDED / TRACK_REMOVED | `conference.trackAdded` / `conference.trackRemoved` | (track) — EventManager:124-129 |
| TRACK_MUTE_CHANGED | `conference.trackMuteChanged` | (track) — JitsiConference.js:3317 |
| TRACK_AUDIO_LEVEL_CHANGED | `conference.audioLevelsChanged` | (participantId, audioLevel) — JitsiConference.js:618/3320 |
| DOMINANT_SPEAKER_CHANGED | `conference.dominantSpeaker` | (id, previousId) |
| MESSAGE_RECEIVED | `conference.messageReceived` | see below ⚠️ |
| ENDPOINT_MESSAGE_RECEIVED | `conference.endpoint_message_received` | **(participant: JitsiParticipant, payload)** ⚠️ — EventManager:242-246 |
| NON_PARTICIPANT_MESSAGE_RECEIVED | `conference.non_participant_message_received` | (id, payload) |
| P2P_STATUS | `conference.p2pStatus` | (isP2PActive) |
| PARTICIPANT_PROPERTY_CHANGED | `conference.participant_property_changed` | (participant, name, value) |
| LAST_N_ENDPOINTS_CHANGED | `conference.lastNEndpointsChanged` | |
| FORWARDED_SOURCES_CHANGED | `conference.forwardedSourcesChanged` | |

⚠️ **MESSAGE_RECEIVED shape (this version)**: emitted with **positional arguments**, not an object:
`(participantId: string, txt: string, ts: number, displayName?: string, isVisitor?: boolean, messageId?: string, source?: string, replyToId?: string)` — `JitsiConferenceEventManager.js:205-210`. `participantId` is the MUC resource (endpoint id). SPEC §7.6 / the `ChatMessage` mapping in `src/types.ts` is satisfied by destructuring these args; there is no single `{from, displayName, id, timestamp}` object in this pin.

⚠️ **ENDPOINT_MESSAGE_RECEIVED**: emits the **`JitsiParticipant` object**, not the endpoint id (SPEC §7.1 shows `ENDPOINT_MESSAGE_RECEIVED(endpointId, payload)`). Adapter must call `participant.getId()`; a foreign `JitsiMeetJS.util`-era payload from a non-participant routes to `NON_PARTICIPANT_MESSAGE_RECEIVED` instead (EventManager:242-249).

## 4. `JitsiMeetJS.createLocalTracks(options)` — `JitsiMeetJS.js:124`, `modules/RTC/RTCUtils.js:520`

`createLocalTracks(options?): Promise<JitsiLocalTrack[]>`; rejects with `JitsiTrackError` (`errors.track` values, JitsiTrackErrors.js — incl. `PERMISSION_DENIED: 'gum.permission_denied'`, `SCREENSHARING_USER_CANCELED: 'gum.screensharing_user_canceled'`).

Verified options (RTCUtils.js:498-518):

- `devices: Array<'audio'|'video'|'desktop'>` (RTCUtils.js:81, 500-501).
- **Device ids are `micDeviceId` / `cameraDeviceId`** ⚠️ (RTCUtils.js:131/173) — NOT `audioDeviceId`/`videoDeviceId` as SPEC §6.4 wording suggests. No `desktopDeviceId` key; `desktopSharingSourceDevice` (device id **or label**) selects a fixed share source.
- `resolution?: string` (shortcut via the `Resolutions` table, e.g. `'720p'`, RTCUtils.js:98-101); `constraints?: MediaStreamConstraints` (raw GUM base; `video.frameRate` supported — defaults applied at RTCUtils.js:27/110).
- `effects?: IStreamEffect[]`, `timeout?: number`.
- Desktop: `desktopSharingFrameRate: {min?, max?}`, `desktopSharingSources: string[]` ('screen', 'window', …).

**Desktop flow**: `devices:['desktop']` → `modules/RTC/ScreenObtainer.js:89-154` uses **`navigator.getDisplayMedia`** (with `navigator.mediaDevices.getDisplayMedia` fallback) — the Chrome-extension path is gone. ⚠️ **`fireMouseEvent` does not exist** anywhere in this pin (SPEC §6.1 item 4 mentions it; it belonged to the removed extension flow). The browser's native "Stop sharing" ends the track → `JitsiTrackEvents.LOCAL_TRACK_STOPPED` (`'track.stopped'`). A desktop track is identified by **`track.getVideoType() === 'desktop'`** (VideoType: `camera` | `desktop` | `desktop_high_fps`, `service/RTC/VideoType.js`). Note the event constant is `TRACK_VIDEOTYPE_CHANGED = 'track.videoTypeChanged'` (JitsiTrackEvents.js:58) — value casing `videoTypeChanged`, key casing as the spec spells it.

## 5. `JitsiTrack` — `modules/RTC/JitsiTrack.js` (+ `JitsiLocalTrack.js`, `JitsiRemoteTrack.js`)

Verified on the base track: `attach(container): Promise<void>` (JitsiTrack.js:194 — returns a promise despite the JSDoc), `detach(container?): void` (:212), `dispose(): Promise<void>`, `getOriginalStream(): MediaStream|null` (:257), `getSourceName(): string` (:264, format `'<endpoint>-a0'|'<endpoint>-v0'` — `service/RTC/SignalingLayer.js:13`), `getSsrc()`, `getStreamId()`, `getTrack(): MediaStreamTrack|null`, `getTrackLabel()`, `getTrackId()`, `getType(): 'audio'|'video'` (:307), `getVideoType()` (:324), `isMuted()` (:384), `isAudioTrack()/isVideoTrack()/isLocal()/isWebRTCTrackMuted()/isActive()`, `getWidth()/getHeight()`, `setAudioOutput(deviceId): Promise<void>` (:424, setSinkId on attached elements), `addEventListener/removeEventListener`.

`getParticipantId()` exists on **both** local (JitsiLocalTrack.js:581) and remote (JitsiRemoteTrack.js:367) tracks. `JitsiLocalTrack` adds `mute(): Promise<void>` (:669), `unmute(): Promise<void>` (:820), `getDeviceId()`, `isEnded()`, `getCaptureResolution()`, `applyConstraints()`.

⚠️ **`getName()` does not exist** on tracks (SPEC §6.1 item 5 / M0 task list): use `getTrackLabel()` / `getUsageLabel()`. ⚠️ There is no public `setSource()`; `setSourceName()` exists on local/remote tracks but is signalling-internal — do not call it. `JitsiTrackEvents` values (JitsiTrackEvents.js):

| Constant | Value |
|---|---|
| LOCAL_TRACK_STOPPED | `track.stopped` |
| NO_AUDIO_INPUT | `track.no_audio_input` |
| NO_DATA_FROM_SOURCE | `track.no_data_from_source` |
| TRACK_AUDIO_LEVEL_CHANGED | `track.audioLevelsChanged` |
| TRACK_AUDIO_OUTPUT_CHANGED | `track.audioOutputChanged` |
| TRACK_MUTE_CHANGED | `track.trackMuteChanged` |
| TRACK_VIDEOTYPE_CHANGED | `track.videoTypeChanged` |
| TRACK_OWNER_SET | `track.owner_set` |
| TRACK_STREAMING_STATUS_CHANGED | `track.streaming_status_changed` |

Conference-level `TRACK_MUTE_CHANGED` / `TRACK_AUDIO_LEVEL_CHANGED` (item 3 table) are re-emitted from the track events by `JitsiConferenceEventManager.js:3317-3320`.

## 6. Endpoint messages — `JitsiConference.js:3746/3764`, `modules/RTC/RTC.js:590`

`sendEndpointMessage(to: string, payload: object): void` (empty `to` = broadcast) → `RTC.sendChannelMessage` → bridge channel `sendMessage(to, payload)`; throws if the bridge channel is not open. `broadcastEndpointMessage(payload)` = `sendEndpointMessage('', payload)` (JitsiConference.js:3764). Both are marked `@deprecated` in favour of `sendMessage(message, to?, sendThroughVideobridge?, replyToId?)` (JitsiConference.js:3774) — still public and functional in this pin; SPEC §7.1 keeps using the endpoint-message names, which is fine.

Receive side: `ENDPOINT_MESSAGE_RECEIVED(participant, payload)` ⚠️ (participant object — see item 3).

## 7. `conference.setReceiverConstraints(obj)` — `JitsiConference.js:3933`

`setReceiverConstraints(videoConstraints): void` → `ReceiveVideoController.setReceiverConstraints` (`modules/qualitycontrol/ReceiveVideoController.js:178`) → `RTC.setReceiverVideoConstraints` (`modules/RTC/RTC.js:248`) → bridge-channel `sendReceiverVideoConstraintsMessage(constraints)` — the object is **passed through verbatim** (clone + isEqual diff). Accepted fields in this pin:

- `lastN?: number` (also maintained by the CPU limiter — the controller forces its own `lastN` in, see ReceiveVideoController.js:186-188),
- `constraints?: { '<sourceName>': { maxHeight } }`, `defaultConstraints?: { maxHeight }`,
- `assumedBandwidthBps?: number`,
- `startLastN?: number` (read by the controller constructor, :24) and `startSources?: string[]` (start-pinned sources, honoured by the bridge; read at session start),
- `selectedSources?: string[]`, `onStageSources?: string[]` — **documented in the method's JSDoc** (JitsiConference.js:3917-3930) and forwarded to the bridge; ⚠️ the lib's *generated* TS interface (`IReceiverVideoConstraints` in the typedoc bundle) declares only `lastN/constraints/defaultConstraints/assumedBandwidthBps` — the runtime set is wider (pass-through). SPEC §9.2's full payload (`lastN`, `selectedSources`, `onStageSources`, `defaultConstraints`, `constraints`) is accepted; the shim types the full runtime set.

`setReceiverVideoConstraint(maxFrameHeight)` exists and is the **legacy single-value API** (JitsiConference.js:3953) — SPEC §9.2 forbids it; the shim marks it `@deprecated`.

## 8. Audio subscriptions (SPEC §8.4 verdict) — **the API EXISTS**

`conference.setAudioSubscriptionMode(message)` **is present** in this pin (JitsiConference.js:2874 → `ReceiveAudioController.setAudioSubscriptionMode`, `modules/qualitycontrol/ReceiveAudioController.js:136`).

- Current shape `IReceiverAudioSubscriptionMessage` (`service/RTC/ReceiverAudioSubscription.js`): `{ all?: boolean (default true), include?: string[], exclude?: string[] }`.
- **Legacy shape `{ mode: 'All'|'Exclude'|'Include'|'None', list?: string[] }` is accepted and normalised** (`normalizeReceiverAudioSubscription`, ReceiverAudioSubscription.js:29-49): `{mode:'Include', list:[...]}` → `{all:false, include:list}`. SPEC §8.4's exact call (`{mode:'Include', list:['<endpoint>-a0', ...]}`) is therefore **valid verbatim**.
- No-op on no change; sent over the bridge channel; re-sent on bridge-channel reopen (`resendSubscription`, ReceiveAudioController.js:126). Empty include with `all:false` = subscribe nothing (deafen case).
- `conference.setAudioSubscriptionPriority('dominant-speaker-only'|'all')` **does NOT exist** in this pin (no match in source). Per-source mute APIs on the receiver side do not exist either.
- ⚠️ Caveat: this is a **receiver-assignment/bridge feature** — it requires a jitsi-videobridge new enough to honour `ReceiverAudioSubscription` messages. Against an older bridge the client-side state updates and the call is harmless (the bridge ignores it); §8.4's local-gain fallback remains the safety net.

**Verdict:** implement §8.4 as written (prefer the current `{all:false, include:[...]}` shape in new code); log a warning and fall back to gain-only if the bridge is old.

## 9. Conference messaging / lifecycle — `JitsiConference.js`

- `sendTextMessage(message, elementName='body', replyToId?, messageId?)` (JitsiConference.js:2530). ⚠️ **Divergence:** the 2nd arg is the XMPP stanza element name, **not** `sendThroughVideoChannel` (SPEC §6.1 item 9). The video-channel variant lives on `sendMessage(message, to, sendThroughVideobridge, replyToId)` (:3774). `sendTextMessage` is `@deprecated` in favour of `sendMessage`. Chat via `sendTextMessage(text)` (plain MUC `body`) + `MESSAGE_RECEIVED` (item 3 shape) is correct for §7.6.
- `setDisplayName(name): void` (:2630) — presence `nick` element.
- `setLocalParticipantProperty(name, value, useRawKeys?): void` (:3649) — presence `<jitsi_participant_<name>>`; `setLocalParticipantProperties(obj, useRawKeys?)` batch form (:3660). `PARTICIPANT_PROPERTY_CHANGED` carries `(participant, name, value)`.
- `join(password?, replaceParticipant?): void` (:2181); `leave(reason?): Promise<void>` (:2304); `isJoined()`; `myUserId(): string|null` (:3480).
- `addEventListener(event, listener)` / `removeEventListener(event, listener?)` — `Listenable` (`modules/util/Listenable.js:44/52`).
- `addTrack/removeTrack/replaceTrack(old,new): Promise<void>` (:2683/2745/2757); `getLocalTracks(mediaType?)`, `getLocalAudioTrack/VideoTrack`.
- `connection.connect(options?)`, `connection.disconnect()`, `connection.addEventListener/removeEventListener` — JitsiConnection.js:52/82/125/133.

## 10. Speaker output selection — **exists**

- `JitsiMeetJS.mediaDevices.setAudioOutputDevice(deviceId): Promise<void>` / `getAudioOutputDevice(): string` (JitsiMediaDevices.js:206/217 → `RTC.setAudioOutputDevice` modules/RTC/RTC.js:525, `RTC.getAudioOutputDevice` :500).
- `JitsiTrack.setAudioOutput(deviceId): Promise<void>` (JitsiTrack.js:424) → `setSinkId` on attached DOM elements; emits `TRACK_AUDIO_OUTPUT_CHANGED` (`track.audioOutputChanged`). Capability probe at load: `setSinkId` is feature-detected against the default sink and disabled session-wide on probe failure (RTCUtils.js:60-68); `isDeviceChangeAvailable('output')` gates it.
- ⚠️ Scope note: this only re-routes audio **attached to DOM elements**. SPEC §8 keeps remote audio in the Web Audio graph (NOT audibly attached), so for spatialised playback the adapter must use `AudioContext.setSinkId` (browser API) on our own graph; the lib's API covers the §8.6 muted-element workaround and local-preview elements.

## 11. Participants — `JitsiConference.js` / `JitsiParticipant.js`

`conference.getParticipants(): JitsiParticipant[]` (:2907), `getParticipantById(id)`, `getParticipantCount(countHidden?)`, `myUserId()` (:3480). `JitsiParticipant` verified: `getId()`, `getDisplayName(): string|undefined`, `getJid()`, `getRole()`, `getStatus()`, `getProperty(name)`, `getSources()`, `getTracks()/getTracksByMediaType()`, `isAudioMuted()`, `isVideoMuted()`, `isModerator()`, `isHidden()`, `isSilent()`, `hasFeature()/getFeatures()`. ⚠️ No `getDisplayNameChanged()` and no `isMuted()` — name changes arrive as `DISPLAY_NAME_CHANGED(id, displayName)` (item 3), mute state as `isAudioMuted()/isVideoMuted()` + `TRACK_MUTE_CHANGED`.

## 12. P2P disable — `confOptions.p2p.enabled`

`p2p: { enabled: false }` in `initJitsiConference` confOptions is the supported switch (constructor JSDoc JitsiConference.js:112-116; `_shouldBeInP2PMode`/`_maybeStartOrStopP2P` honour it; `conference.isP2PEnabled()` reads it). JitsiMap MUST set `enabled: false` so poses always travel via the JVB bridge channel (§7.1) and media stays bridge-relayed (SPEC §9.2 constraints are bridge-channel semantics). The `P2P_STATUS` event remains subscribed for diagnostics.

## Divergence summary (spec → reality)

| # | SPEC assumption | Reality in v2236.0.0+51058e35 | Shim adaptation |
|---|---|---|---|
| 1 | `bosh` in connection options (§6.2/§13) | **throws** — use `serviceUrl` (websocket) | `IConnectionOptions.serviceUrl` required; no `bosh` field |
| 2 | `ENDPOINT_MESSAGE_RECEIVED(endpointId, payload)` (§7.1) | `(participant: JitsiParticipant, payload)` | overload typed with `JitsiParticipant`; adapter calls `.getId()` |
| 3 | `MESSAGE_RECEIVED` object with from/displayName/id/timestamp | positional `(id, txt, ts, displayName, isVisitor, messageId, source, replyToId)` | typed positional overload |
| 4 | `sendTextMessage(text, sendThroughVideoChannel?)` | `(message, elementName?, replyToId?, messageId?)`; videobridge flag lives on `sendMessage` | both typed; §7.6 chat uses `sendTextMessage(text)` |
| 5 | `createLocalTracks` `audioDeviceId`/`videoDeviceId`, `fireMouseEvent` | `micDeviceId`/`cameraDeviceId`; `fireMouseEvent` removed; desktop = `getDisplayMedia` | `ILocalTrackOptions` with real keys |
| 6 | `setReceiverConstraints` incl. `selectedSources`/`onStageSources` (§9.2) | accepted & forwarded (documented in JSDoc); generated lib interface lists only 4 fields | shim types the full runtime set |
| 7 | `setAudioSubscriptionMode({mode:'Include', list})` (§8.4) | **exists** — legacy `{mode,list}` normalised to `{all,include,exclude}`; bridge-version caveats | union type; §8.4 implementable as written |
| 8 | track `getName()` (§6.1 item 5) | absent | `getTrackLabel()`/`getUsageLabel()` |
| 9 | participant `getDisplayNameChanged` / `isMuted` (M0 task list) | absent; use `DISPLAY_NAME_CHANGED` + `isAudioMuted()/isVideoMuted()` | typed accordingly |
| 10 | connection event "interrupted" (§6.1 item 2) | conference-level `CONNECTION_INTERRUPTED`/`RESTORED` | typed on the conference |
| 11 | `JitsiConferenceEvents.DATA_CHANNEL_OPENED` | confirmed: `conference.dataChannelOpened` | — |
| 12 | audio output API (§8.6) | `mediaDevices.setAudioOutputDevice` + `track.setAudioOutput` (setSinkId on attached elements) | typed; Web-Audio sink handled app-side |

## M0 gate status

- **Signatures verified ✓** — every §6.1 item checked against the pinned dist/esm source; `src/jitsi/types.d.ts` encodes the verified surface (literal event strings included) and `test/lib-surface.test.ts` pins the literals at compile + value level (`npx tsc --noEmit` and `npx vitest run` green).
- **Two-tab endpoint-message exchange** (the live M0 spike page) is **deferred to the browser matrix (§16.3)**: it needs a browser + a running full-mode stack, which this node environment cannot provide; the two-tab exchange is exercised by the §16.3 manual checklist and the §16.2 Playwright smoke test at M1+. Stated honestly per SPEC §17: the *signature gate* is closed; the *live two-tab* exit criterion is scheduled, not verified.
