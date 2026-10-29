/**
 * Avatar rendering — SPEC §5.2/§5.3/§7.3/§8.3. Phaser owns ONLY rendering
 * state (SPEC §11): every frame we diff the store snapshot, compute each
 * remote avatar's display pose via `viewport.interpolatePose` (with the §7.3
 * >64 px snap rule applied at pose receipt), and position containers.
 *
 * Visual contract per avatar (§5.5 — never colour-only):
 *  - base circle + emoji text sprite (§10.3: emoji is the MVP default),
 *  - optional https-only `imageUrl` texture (SPEC §14),
 *  - name label below,
 *  - speaking ring when `audioLevel` exceeds the threshold,
 *  - 🔇 badge when the mic is muted (icon, not colour),
 *  - 2 s emoji burst above the avatar on `store.onEmote` (§5.3).
 *
 * Also owns the on-canvas local zone label (Silent zone per §8.3, stage
 * indicator) and the aria getters (§5.5): current zone label + nearby count.
 */

import Phaser from 'phaser';

import { store } from '../store';
import { type AvatarInfo, type ReceivedPose, TILE_SIZE, type ZoneDef } from '../types';
import type { GameMapData } from './maps';
import { interpolatePose, SNAP_DISTANCE_PX } from './viewport';

/** Audio level above which the speaking ring shows (TRACK_AUDIO_LEVEL_CHANGED 0..1). */
export const SPEAKING_LEVEL_THRESHOLD = 0.03;
/** Emoji burst lifetime (SPEC §5.3 "expires ~2 s"). */
export const EMOTE_BURST_MS = 2000;
/** "Nearby" radius for the §5.5 aria label — matches HEAR_RADIUS_TILES (8×32). */
export const NEARBY_RADIUS_PX = 8 * TILE_SIZE;

const BASE_RADIUS = 12;
const EMOJI_FONT = '22px "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", sans-serif';
const LABEL_FONT = '11px system-ui, sans-serif';
const BADGE_FONT = '12px "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** Avatar container depths: under the `above` layer (30), sorted by y. */
const DEPTH_BASE = 10;

export interface AvatarCallbacks {
  /** Pointerdown on the LOCAL avatar → emote (§5.3). */
  onLocalAvatarClick(): void;
}

interface AvatarView {
  container: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Graphics;
  emoji: Phaser.GameObjects.Text;
  image: Phaser.GameObjects.Image | null;
  name: Phaser.GameObjects.Text;
  mute: Phaser.GameObjects.Text;
  /** Last applied avatar/appearance key (emoji vs imageUrl) — diff per frame. */
  appliedKey: string;
  /** Last processed ReceivedPose.at (0 = none) — drives the snap rule. */
  lastPoseAt: number;
  /** The pose fed to `interpolatePose` after the snap rule. */
  received: ReceivedPose | null;
  /** Current interpolated display position. */
  display: { x: number; y: number };
  speaking: boolean;
  mutedShown: boolean;
}

/**
 * HUD label for a zone (§8.3: silent zones show a "Silent zone" label;
 * §9.3 stage indicator). Never colour-only (§5.5). Pure.
 */
export function zoneHudLabel(zone: ZoneDef | null): string | null {
  if (!zone) return null;
  const name = zone.label ?? zone.id;
  const tags: string[] = [];
  if (zone.silent) tags.push('🔇 Silent zone');
  if (zone.stage) tags.push('🎙 Stage');
  return tags.length > 0 ? `${name} · ${tags.join(' · ')}` : name;
}

/**
 * Owns all avatar containers + the local zone label. The scene drives
 * {@link update} once per frame; `localSprite` is handed to the
 * {@link MovementController}, which sets its position.
 */
export class AvatarManager {
  readonly localSprite: Phaser.GameObjects.Container;

  private readonly remotes = new Map<string, AvatarView>();
  private readonly emotes = new Set<Phaser.GameObjects.Text>();
  private readonly zoneLabel: Phaser.GameObjects.Text;
  private lastZoneId: string | null | undefined; // undefined = never set
  private unsubEmote: () => void;
  private disposed = false;

  constructor(
    private scene: Phaser.Scene,
    readonly map: GameMapData,
    private cb: AvatarCallbacks,
  ) {
    this.localSprite = this.createAvatar(store.getSnapshot().local.name, store.getSnapshot().local.avatar, true);
    this.localSprite.setDepth(DEPTH_BASE + 0.5);

    // Zone label: screen-fixed (scrollFactor 0), fades in on zone entry (§5.2).
    this.zoneLabel = scene.add
      .text(scene.scale.width / 2, 16, '', {
        fontFamily: LABEL_FONT,
        fontSize: '15px',
        color: '#f2f2f5',
        backgroundColor: 'rgba(12,12,20,0.65)',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setDepth(100)
      .setScrollFactor(0)
      .setAlpha(0)
      .setResolution(2);

    this.unsubEmote = store.onEmote((e) => this.spawnEmote(e.endpointId, e.emoji));
    scene.scale.on('resize', this.onResize);
  }

  private onResize = (): void => {
    this.zoneLabel.setX(this.scene.scale.width / 2);
  };

  // ------------------------------------------------------------- per frame

  /** Diff the store snapshot into the scene graph. `now` = scene time (ms). */
  update(now: number): void {
    if (this.disposed) return;
    const snap = store.getSnapshot();

    // Local appearance (settings may change mid-session).
    this.applyAvatar(this.localAvatarView(), snap.local.avatar);
    const localView = this.localAvatarView();
    localView.name.setText(truncate(snap.local.name, 24));

    // Remote avatars: create/update participants with poses, drop the rest
    // (left peers and pose-less stock-Meet users get no avatar, §7.7).
    const seen = new Set<string>();
    for (const p of snap.participants) {
      if (!p.pose || p.id === snap.local.id) continue;
      seen.add(p.id);
      let view = this.remotes.get(p.id);
      if (!view) {
        view = this.createAvatarView(p.name, p.avatar, false);
        const start = interpolatePose(p.pose, now);
        view.display = { x: start.x, y: start.y };
        view.container.setPosition(start.x, start.y);
        this.remotes.set(p.id, view);
      }
      // Snap rule at receipt (§7.3): if the new TARGET is >64 px from the
      // current display pose, restart interpolation from the target.
      if (p.pose.at !== view.lastPoseAt) {
        view.lastPoseAt = p.pose.at;
        const t = p.pose.target;
        const jump = Math.hypot(t.x - view.display.x, t.y - view.display.y);
        view.received = jump > SNAP_DISTANCE_PX ? { ...p.pose, prev: t, prevAt: p.pose.at } : p.pose;
      }
      if (view.received) {
        const d = interpolatePose(view.received, now);
        view.display = { x: d.x, y: d.y };
        view.container.setPosition(d.x, d.y);
      }
      // Depth: avatars lower on the map draw in front of those above them.
      view.container.setDepth(DEPTH_BASE + Math.min(view.display.y, 9999) / 10000);
      this.applyAvatar(view, p.avatar);
      view.name.setText(truncate(p.name, 24));
      const speaking = p.audioLevel > SPEAKING_LEVEL_THRESHOLD && !p.mutedForMe;
      if (speaking !== view.speaking) {
        view.speaking = speaking;
        this.drawBase(view);
      }
      const muted = p.micMuted || p.mutedForMe;
      if (muted !== view.mutedShown) {
        view.mutedShown = muted;
        view.mute.setVisible(muted);
      }
    }
    for (const [id, view] of this.remotes) {
      if (!seen.has(id)) {
        view.container.destroy();
        this.remotes.delete(id);
      }
    }

    // Local position depth (movement owns x/y) + zone label.
    const lv = this.localAvatarView();
    lv.container.setDepth(DEPTH_BASE + 0.5 + Math.min(lv.display.y, 9999) / 10000);
    const localPose = snap.local.pose;
    if (localPose) lv.display = { x: localPose.x, y: localPose.y };
    this.updateZoneLabel(snap.localZone);
  }

  // ------------------------------------------------------------- aria (§5.5)

  /** Current zone label text + number of nearby participants (canvas aria-label). */
  aria(): { zoneLabel: string | null; nearby: number } {
    const snap = store.getSnapshot();
    const lp = snap.local.pose;
    let nearby = 0;
    if (lp) {
      for (const p of snap.participants) {
        const pose = p.pose?.target;
        if (!pose) continue;
        if (Math.hypot(pose.x - lp.x, pose.y - lp.y) <= NEARBY_RADIUS_PX) nearby++;
      }
    }
    return { zoneLabel: zoneHudLabel(snap.localZone), nearby };
  }

  // ------------------------------------------------------------- emotes

  private spawnEmote(endpointId: string, emoji: string): void {
    const snap = store.getSnapshot();
    const target =
      endpointId === (snap.local.id ?? 'local') ? this.localSprite : (this.remotes.get(endpointId)?.container ?? null);
    if (!target) return;
    const t = this.scene.add
      .text(target.x, target.y - BASE_RADIUS - 22, emoji, { fontFamily: EMOJI_FONT, fontSize: '24px' })
      .setOrigin(0.5)
      .setDepth(50);
    this.emotes.add(t);
    this.scene.tweens.add({
      targets: t,
      y: t.y - 28,
      alpha: 0,
      duration: EMOTE_BURST_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.emotes.delete(t);
        t.destroy();
      },
    });
  }

  // ------------------------------------------------------------- internals

  private updateZoneLabel(zone: ZoneDef | null): void {
    const id = zone?.id ?? null;
    if (id === this.lastZoneId) return;
    this.lastZoneId = id;
    const label = zoneHudLabel(zone);
    this.zoneLabel.setText(label ?? '');
    this.scene.tweens.killTweensOf(this.zoneLabel);
    if (label) {
      this.zoneLabel.setAlpha(1);
      this.scene.tweens.add({ targets: this.zoneLabel, alpha: 0.001, delay: 2500, duration: 900 });
    }
  }

  /** The local avatar view (positions come from the MovementController). */
  private localView: AvatarView | null = null;
  private localAvatarView(): AvatarView {
    if (!this.localView) {
      const c = this.localSprite;
      this.localView = {
        container: c,
        base: c.list[0] as Phaser.GameObjects.Graphics,
        emoji: c.list[1] as Phaser.GameObjects.Text,
        image: null,
        name: c.list[2] as Phaser.GameObjects.Text,
        mute: c.list[3] as Phaser.GameObjects.Text,
        appliedKey: '',
        lastPoseAt: 0,
        received: null,
        display: { x: c.x, y: c.y },
        speaking: false,
        mutedShown: false,
      };
    }
    return this.localView;
  }

  private createAvatar(name: string, avatar: AvatarInfo, isLocal: boolean): Phaser.GameObjects.Container {
    return this.createAvatarView(name, avatar, isLocal).container;
  }

  private createAvatarView(name: string, avatar: AvatarInfo, interactive: boolean): AvatarView {
    const s = this.scene;
    const base = s.add.graphics();
    const emoji = s.add.text(0, -2, avatar.emoji, { fontFamily: EMOJI_FONT }).setOrigin(0.5);
    const label = s.add
      .text(0, 14, truncate(name, 24), {
        fontFamily: LABEL_FONT,
        color: '#f2f2f5',
        backgroundColor: 'rgba(10,10,16,0.55)',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 0)
      .setResolution(2);
    const mute = s.add.text(11, -14, '🔇', { fontFamily: BADGE_FONT }).setOrigin(0.5).setVisible(false);
    const container = s.add.container(0, 0, [base, emoji, label, mute]).setDepth(DEPTH_BASE);
    container.setSize(BASE_RADIUS * 2 + 12, BASE_RADIUS * 2 + 12);
    if (interactive) {
      // Click own avatar → emote (§5.3). Hit area is the base circle.
      container.setInteractive(new Phaser.Geom.Circle(0, 0, BASE_RADIUS + 4), Phaser.Geom.Circle.Contains);
      container.on('pointerdown', () => this.cb.onLocalAvatarClick());
    }
    const view: AvatarView = {
      container,
      base,
      emoji,
      image: null,
      name: label,
      mute,
      appliedKey: '',
      lastPoseAt: 0,
      received: null,
      display: { x: 0, y: 0 },
      speaking: false,
      mutedShown: false,
    };
    this.applyAvatar(view, avatar);
    this.drawBase(view);
    return view;
  }

  private drawBase(view: AvatarView): void {
    const g = view.base;
    g.clear();
    g.fillStyle(0x0d0d16, 0.55);
    g.fillCircle(0, 0, BASE_RADIUS);
    g.lineStyle(1, 0xffffff, 0.25);
    g.strokeCircle(0, 0, BASE_RADIUS);
    if (view.speaking) {
      g.lineStyle(2.5, 0x4be08a, 0.95); // ring + (for remotes) the label is static; ring is an icon-like shape
      g.strokeCircle(0, 0, BASE_RADIUS + 3);
    }
  }

  /** Emoji ↔ https imageUrl (SPEC §14: https only; http/rejected URLs never load). */
  private applyAvatar(view: AvatarView, avatar: AvatarInfo): void {
    const key = avatar.imageUrl ? `url:${avatar.imageUrl}` : `emoji:${avatar.emoji}`;
    if (key === view.appliedKey) return;
    view.appliedKey = key;
    view.image?.destroy();
    view.image = null;
    if (!avatar.imageUrl) {
      view.emoji.setText(avatar.emoji).setVisible(true);
      return;
    }
    const textureKey = `jitmap-avatar:${avatar.imageUrl}`;
    const attach = (): void => {
      if (this.disposed || view.appliedKey !== key) return;
      if (!this.scene.textures.exists(textureKey)) return; // load failed → keep emoji
      view.emoji.setVisible(false);
      view.image = this.scene.add
        .image(0, -2, textureKey)
        .setDisplaySize(BASE_RADIUS * 2, BASE_RADIUS * 2)
        .setDepth(0);
      view.container.add(view.image);
    };
    if (this.scene.textures.exists(textureKey)) {
      attach();
      return;
    }
    // https-only gate (§14). Phaser's Image loader cannot set Referrer-Policy
    // per request; the host page should ship `<meta name="referrer"
    // content="no-referrer">` so avatar URLs leak no page referrer. CORS
    // 'anonymous' keeps the texture readable by WebGL on remote hosts.
    if (!avatar.imageUrl.startsWith('https://')) return;
    const loader = this.scene.load;
    loader.setCORS('anonymous');
    loader.image(textureKey, avatar.imageUrl);
    loader.once(Phaser.Loader.Events.COMPLETE, attach);
    loader.start();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubEmote();
    this.scene.scale.off('resize', this.onResize);
    for (const t of this.emotes) t.destroy();
    this.emotes.clear();
    for (const v of this.remotes.values()) v.container.destroy();
    this.remotes.clear();
    this.localSprite.destroy();
    this.zoneLabel.destroy();
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
