/**
 * Video bubbles — SPEC §9.1/§11. A pointer-transparent DOM overlay over the
 * Phaser canvas: one 96×72 <video> per visible remote participant, positioned
 * over their interpolated avatar every frame via the pure viewport math; the
 * local user's bubble shows the own-camera preview (§5.2). The Room's rAF
 * loop drives `tick()` through the imperative handle.
 *
 * Budget (§11): ≤16 video elements — `visibleBubbleSet` caps nearest-first.
 * Streams attach via getTrackStream → srcObject (§6.5 seam, the same one the
 * frozen audio engine uses) and detach + get removed when invisible. Names
 * render as plain text nodes (§14).
 *
 * Pure exports (bubblePlacement / visibleBubbleSet) are node-testable —
 * test/ui.test.ts.
 */

import type { RefObject } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { type CamView, interpolatePose, type Point, worldToScreen } from '../game/viewport';
import type { JitsiClient } from '../jitsi/api';
import { getTrackStream } from '../jitsi/tracks';
import { distanceTiles } from '../spatial/distance';
import { store } from '../store';
import type { Pose, RemoteState, ZoneDef } from '../types';
import { BUBBLE_H, BUBBLE_HEAD_OFFSET, BUBBLE_W, bubbleVisible, MAX_VIDEO_BUBBLES, ownPreviewVisible } from './util';

// ---------------------------------------------------------------- pure math

/** World px → overlay px for a bubble anchored above the avatar (head-up). */
export function bubblePlacement(world: Point, cam: CamView): { left: number; top: number } {
  const p = worldToScreen(world, cam);
  return {
    left: Math.round(p.x - BUBBLE_W / 2),
    top: Math.round(p.y - BUBBLE_HEAD_OFFSET * cam.zoom - BUBBLE_H),
  };
}

/** §9.1 visibility + §11 ≤16 cap: nearest in-radius participants win. */
export function visibleBubbleSet(
  participants: readonly RemoteState[],
  localPose: Pose | null,
  zones: ReadonlyMap<string, ZoneDef>,
): RemoteState[] {
  return participants
    .filter((p) => bubbleVisible(p, localPose, zones))
    .sort(
      (a, b) =>
        distanceTiles(localPose!.x, localPose!.y, a.pose!.target.x, a.pose!.target.y) -
          distanceTiles(localPose!.x, localPose!.y, b.pose!.target.x, b.pose!.target.y) || a.id.localeCompare(b.id),
    )
    .slice(0, MAX_VIDEO_BUBBLES);
}

// ---------------------------------------------------------------- component

export interface VideoBubblesHandle {
  /** Position/attach every bubble — called once per rendered frame. */
  tick(): void;
}

export interface VideoBubblesProps {
  client: JitsiClient;
  /** Local camera on → own preview bubble over the local avatar (§5.2). */
  camOn: boolean;
  /** Live camera snapshot written by the Room's rAF loop. */
  cameraRef: RefObject<CamView | null>;
}

interface BubbleEntry {
  root: HTMLDivElement;
  video: HTMLVideoElement;
  name: HTMLDivElement;
  stream: MediaStream | null;
}

interface SelfEntry {
  root: HTMLDivElement;
  video: HTMLVideoElement;
}

export const VideoBubbles = forwardRef<VideoBubblesHandle, VideoBubblesProps>(function VideoBubbles(
  { client, camOn, cameraRef },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const entries = useRef(new Map<string, BubbleEntry>());
  const selfRef = useRef<SelfEntry | null>(null);
  const camOnRef = useRef(camOn);
  camOnRef.current = camOn;
  const clientRef = useRef(client);
  clientRef.current = client;

  const ensureBubble = (host: HTMLElement, p: RemoteState): BubbleEntry => {
    let e = entries.current.get(p.id);
    if (!e) {
      const root = document.createElement('div');
      root.className = 'jm-bubble';
      const video = document.createElement('video');
      video.className = 'jm-bubble__video';
      video.playsInline = true;
      video.muted = true;
      video.autoplay = true;
      const name = document.createElement('div');
      name.className = 'jm-bubble__name';
      root.append(video, name);
      host.append(root);
      e = { root, video, name, stream: null };
      entries.current.set(p.id, e);
    }
    const label = p.name || 'Guest';
    if (e.name.textContent !== label) e.name.textContent = label; // plain text (§14)
    return e;
  };

  const ensureSelf = (host: HTMLElement): SelfEntry => {
    let s = selfRef.current;
    if (!s) {
      const root = document.createElement('div');
      root.className = 'jm-bubble jm-bubble--self';
      const video = document.createElement('video');
      video.className = 'jm-bubble__video jm-bubble__video--self';
      video.playsInline = true;
      video.muted = true;
      video.autoplay = true;
      const name = document.createElement('div');
      name.className = 'jm-bubble__name';
      name.textContent = 'You';
      root.append(video, name);
      host.append(root);
      clientRef.current.attachLocalVideo(video);
      s = { root, video };
      selfRef.current = s;
    }
    return s;
  };

  const dropSelf = (): void => {
    const s = selfRef.current;
    if (!s) return;
    selfRef.current = null;
    clientRef.current.detachLocalVideo(s.video);
    s.video.srcObject = null;
    s.root.remove();
  };

  const tick = (): void => {
    const host = hostRef.current;
    if (!host) return;
    const cam = cameraRef.current;
    const snap = store.getSnapshot();
    const localPose = snap.local.pose;
    const visible = cam && localPose ? visibleBubbleSet(snap.participants, localPose, store.zones()) : [];
    const now = Date.now();
    const seen = new Set<string>();

    for (const p of visible) {
      seen.add(p.id);
      const e = ensureBubble(host, p);
      const r = p.pose;
      if (r) {
        const t = interpolatePose(r, now);
        const { left, top } = bubblePlacement({ x: t.x, y: t.y }, cam!);
        e.root.style.transform = `translate(${left}px, ${top}px)`;
      }
      const stream = getTrackStream(p.videoTrack);
      if (stream !== e.stream) {
        e.stream = stream;
        e.video.srcObject = stream;
        void e.video.play().catch(() => undefined); // autoplay-policy races are benign
      }
    }

    for (const [id, e] of entries.current) {
      if (seen.has(id)) continue;
      entries.current.delete(id);
      e.video.srcObject = null; // detach (§11: out-of-radius streams released)
      e.root.remove();
    }

    if (cam && localPose && ownPreviewVisible(camOnRef.current)) {
      const s = ensureSelf(host);
      const { left, top } = bubblePlacement({ x: localPose.x, y: localPose.y }, cam);
      s.root.style.transform = `translate(${left}px, ${top}px)`;
    } else {
      dropSelf();
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a stable ref-backed callback
  useImperativeHandle(ref, () => ({ tick }), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount cleanup only
  useEffect(
    () => () => {
      for (const e of entries.current.values()) {
        e.video.srcObject = null;
        e.root.remove();
      }
      entries.current.clear();
      dropSelf();
    },
    [],
  );

  return <div className="jm-bubbles" ref={hostRef} aria-hidden="true" />;
});
