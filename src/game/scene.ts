/**
 * The Phaser scene — SPEC §5.2/§5.3, §11. Phaser renders; the store owns
 * truth. Per frame: MovementController tick (writes the local pose), then
 * AvatarManager diff+interpolation (reads the store). Network stays in the
 * host: the scene only calls `callbacks.onEmote`, the UI wires it to
 * `client.sendEmote` (the burst itself is echoed through `store.emitEmote`).
 *
 * Tile rendering choice (documented per task): the starter maps ship ONE
 * embedded image tileset, so each static layer (ground/furniture/above) is
 * baked ONCE into a full-map `RenderTexture` by drawing tileset spritesheet
 * frames at tile positions. Three 1280×960 textures, zero per-frame tile
 * cost, exact §10.2 layer ordering. Dynamic content (avatars, emotes, zone
 * labels) are regular game objects above the bakes.
 */

import Phaser from 'phaser';
import { EMOTE_RATE_LIMIT_MS } from '../protocol';
import { store } from '../store';
import { TILE_SIZE, type ZoneDef } from '../types';
import { AvatarManager } from './avatars';
import type { GameMapData } from './maps';
import { resolveGid } from './maps';
import { MovementController } from './movement';
import { MAX_ZOOM, MIN_ZOOM } from './viewport';

/** Emojis the `E` key / avatar-click burst cycles through (§5.3). */
export const EMOTE_BURST = ['👋', '❤️', '😂', '😮', '👏', '🔥', '🎉', '😢'] as const;

export interface GameCallbacks {
  /** Local emote request — the host sends it (§7.2) and echoes via store. */
  onEmote(emoji: string): void;
  /** Zone the local avatar is in changed (§5.2 HUD / §5.5 aria). */
  onZoneChange?(zone: ZoneDef | null): void;
  /** Nearby-participant count for the canvas aria-label changed (§5.5). */
  onNearbyChange?(count: number): void;
}

export interface SceneData {
  mapData: GameMapData;
  callbacks?: GameCallbacks;
  /** Draw subtle zone outlines (dev aid; default off, `?debugZones` in the host). */
  debugZones?: boolean;
}

const DEPTH = { ground: 0, furniture: 1, zones: 5, above: 30, hud: 100 } as const;

export class MapScene extends Phaser.Scene {
  private mapData!: GameMapData;
  private callbacks: GameCallbacks = { onEmote: () => {} };
  private debugZones = false;

  private avatars: AvatarManager | null = null;
  private controller: MovementController | null = null;
  private lastEmoteAt = 0;
  private lastAria = { zoneLabel: '__init__' as string | null, nearby: -1 };

  constructor() {
    super('jitmap');
  }

  init(data: SceneData | Phaser.Data.DataManager): void {
    // Scene data arrives as a plain object (scene.start) or a DataManager
    // (game config `data`), so normalise via getAll().
    const d = (
      typeof (data as Phaser.Data.DataManager)?.getAll === 'function'
        ? (data as Phaser.Data.DataManager).getAll()
        : data
    ) as SceneData;
    this.mapData = d.mapData;
    this.callbacks = d.callbacks ?? { onEmote: () => {} };
    this.debugZones = d.debugZones === true;
  }

  preload(): void {
    // One spritesheet per embedded image tileset: frames are the tile ids.
    for (const ts of this.mapData.tilesets) {
      this.load.spritesheet(ts.key, `/maps/${ts.image}`, {
        frameWidth: ts.tileWidth,
        frameHeight: ts.tileHeight,
        margin: ts.margin,
        spacing: ts.spacing,
      });
    }
  }

  create(): void {
    const map = this.mapData;
    const cam = this.cameras.main;
    cam.setBounds(0, 0, map.widthPx, map.heightPx);
    cam.setBackgroundColor('#14141c');
    cam.setRoundPixels(true);

    this.renderLayers();
    this.renderZones();

    this.avatars = new AvatarManager(this, map, {
      onLocalAvatarClick: () => this.requestEmote(), // §5.3: click own avatar
    });
    this.controller = new MovementController(this, map, {
      onLocalEmote: () => this.requestEmote(), // §5.3: E key
    });
    this.controller.attach(this.avatars.localSprite);

    // Camera follows the local avatar, clamped to map bounds (§5.3).
    cam.startFollow(this.avatars.localSprite, true, 0.25, 0.25);
    cam.setZoom(1);

    // Wheel zoom, clamped 0.5×–2.5×. (Pinch needs a gesture plugin; MVP = wheel.)
    this.input.mouse?.disableContextMenu();
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const z = Phaser.Math.Clamp(cam.zoom * (dy < 0 ? 1.1 : 1 / 1.1), MIN_ZOOM, MAX_ZOOM);
      cam.setZoom(z);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
  }

  override update(_time: number, delta: number): void {
    this.controller?.update(delta); // writes the local pose to the store
    // Date.now() — the clock the store stamps ReceivedPose.at/prevAt with (§7.3).
    this.avatars?.update(Date.now());
    this.pushAria();
  }

  /** E key / own-avatar click → rate-limited local emote (§5.3 ≤2/s). */
  requestEmote(): void {
    const now = this.time.now;
    if (now - this.lastEmoteAt < EMOTE_RATE_LIMIT_MS) return;
    this.lastEmoteAt = now;
    const emoji = EMOTE_BURST[Math.floor(Math.random() * EMOTE_BURST.length)]!;
    const id = store.getSnapshot().local.id ?? 'local';
    store.emitEmote({ endpointId: id, emoji, ts: Date.now() }); // local echo → burst
    this.callbacks.onEmote(emoji); // host → client.sendEmote (§7.2)
  }

  /** Live scene handles for the host (camera reads, aria). */
  get ariaInfo(): { zoneLabel: string | null; nearby: number } {
    return this.avatars?.aria() ?? { zoneLabel: null, nearby: 0 };
  }

  // ---------------------------------------------------------------- baking

  /** Bake ground/furniture/above into one RenderTexture each (see header). */
  private renderLayers(): void {
    const map = this.mapData;
    const depths: Record<string, number> = {
      ground: DEPTH.ground,
      furniture: DEPTH.furniture,
      above: DEPTH.above,
    };
    for (const layer of map.layers) {
      const rt = this.add
        .renderTexture(0, 0, map.widthPx, map.heightPx)
        .setOrigin(0, 0)
        .setDepth(depths[layer.name] ?? 0);
      for (let i = 0; i < layer.data.length; i++) {
        const hit = resolveGid(map, layer.data[i]!);
        if (!hit) continue; // empty tile / unknown gid — skip (§10.2)
        rt.draw(
          this.textures.getFrame(hit.key, hit.frame),
          (i % map.width) * TILE_SIZE,
          Math.floor(i / map.width) * TILE_SIZE,
        );
      }
    }
  }

  /** Zone name labels; optional subtle debug outlines. */
  private renderZones(): void {
    for (const z of this.mapData.zones) {
      const color = z.silent ? '#bce6ff' : z.stage ? '#ffe8a3' : '#f4f4f8';
      this.add
        .text(z.x + z.w / 2, z.y + 6, z.label ?? z.id, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '13px',
          fontStyle: 'bold',
          color,
          backgroundColor: 'rgba(14, 14, 22, 0.76)',
          padding: { x: 8, y: 3 },
        })
        .setOrigin(0.5, 0)
        .setAlpha(0.95)
        .setDepth(DEPTH.zones)
        .setResolution(2);
      if (this.debugZones) {
        const g = this.add.graphics().setDepth(DEPTH.zones);
        g.lineStyle(1, z.silent ? 0x53c6ff : z.stage ? 0xffcf53 : 0xffffff, 0.35);
        g.strokeRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1);
      }
    }
  }

  private pushAria(): void {
    const info = this.ariaInfo;
    if (info.zoneLabel !== this.lastAria.zoneLabel) {
      this.lastAria.zoneLabel = info.zoneLabel;
      this.callbacks.onZoneChange?.(store.zoneAt(store.getLocalPose()));
    }
    if (info.nearby !== this.lastAria.nearby) {
      this.lastAria.nearby = info.nearby;
      this.callbacks.onNearbyChange?.(info.nearby);
    }
  }

  private cleanup(): void {
    this.controller?.dispose();
    this.controller = null;
    this.avatars?.destroy();
    this.avatars = null;
  }
}

export interface GameHandle {
  destroy(): void;
  readonly scene: MapScene | null;
}

/**
 * Host factory (React mounts a container div; the scene owns everything).
 * Phaser.AUTO, parent = the given element, RESIZE-scale to its size.
 */
export function createGame(
  parent: HTMLElement,
  mapData: GameMapData,
  callbacks: GameCallbacks = { onEmote: () => {} },
  opts: { debugZones?: boolean; debugExpose?: boolean } = {},
): GameHandle {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#14141c',
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: Math.max(1, parent.clientWidth),
      height: Math.max(1, parent.clientHeight),
    },
  });
  // Boot the scene explicitly AFTER the game is ready: Phaser passes
  // SceneManager.add()'s `data` to init() via settings.data — a scene entry
  // inside the Game config cannot carry it (settings.data is hardcoded {}
  // there and the scene auto-boots without payload).
  game.events.once(Phaser.Core.Events.READY, () => {
    game.scene.add('jitmap', new MapScene(), true, {
      mapData,
      callbacks,
      debugZones: opts.debugZones,
    });
  });
  if (opts.debugExpose) {
    (window as unknown as { __jitmapGame: Phaser.Game }).__jitmapGame = game;
  }
  return {
    destroy(): void {
      game.destroy(true);
    },
    get scene(): MapScene | null {
      return (game.scene.getScene('jitmap') as MapScene | undefined) ?? null;
    },
  };
}
