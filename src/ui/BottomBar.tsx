/**
 * Bottom bar — SPEC §5.2/§5.5/§8.5. Every control keyboard-focusable with a
 * visible focus ring, mute states icon + text label (never colour alone).
 * Mic/cam/share state lives in the Room (seeded from Session.join, driven
 * through the JitsiClient); deafen + master volume are store settings (§8.5);
 * the zone chip reads store.localZone (§5.2).
 */

import { useState } from 'react';

import { store } from '../store';
import { useStore } from './hooks';
import { EMOTE_ROW, masterToSlider, sliderToMaster } from './util';

export interface BottomBarProps {
  micOn: boolean;
  camOn: boolean;
  sharing: boolean;
  sidebarOpen: boolean;
  activeTab: 'chat' | 'people';
  unreadChat: number;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleShare: () => void;
  onSendEmote: (emoji: string) => void;
  onToggleTab: (tab: 'chat' | 'people') => void;
  onOpenSettings: () => void;
  /** Resolves true when the invite link landed on the clipboard. */
  onCopyInvite: () => Promise<boolean>;
  onLeave: () => void;
}

export function BottomBar({
  micOn,
  camOn,
  sharing,
  sidebarOpen,
  activeTab,
  unreadChat,
  onToggleMic,
  onToggleCam,
  onToggleShare,
  onSendEmote,
  onToggleTab,
  onOpenSettings,
  onCopyInvite,
  onLeave,
}: BottomBarProps) {
  const { settings, localZone } = useStore();
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyInvite = async (): Promise<void> => {
    if (await onCopyInvite()) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="jm-bar">
      <button
        className="jm-btn"
        type="button"
        aria-pressed={micOn}
        onClick={onToggleMic}
        title={micOn ? 'Mute microphone' : 'Unmute microphone'}
      >
        <span aria-hidden="true">{micOn ? '🎙️' : '🔇'}</span>
        {micOn ? 'Mic' : 'Muted'}
      </button>

      <button
        className="jm-btn"
        type="button"
        aria-pressed={camOn}
        onClick={onToggleCam}
        title={camOn ? 'Turn camera off' : 'Turn camera on'}
      >
        <span aria-hidden="true">{camOn ? '📹' : '📷'}</span>
        {camOn ? 'Camera' : 'Camera off'}
      </button>

      <button
        className="jm-btn"
        type="button"
        aria-pressed={sharing}
        onClick={onToggleShare}
        title={sharing ? 'Stop sharing your screen' : 'Share your screen'}
      >
        <span aria-hidden="true">🖥️</span>
        {sharing ? 'Stop share' : 'Share'}
      </button>

      <button
        className="jm-btn"
        type="button"
        aria-expanded={emotesOpen}
        aria-haspopup="true"
        onClick={() => setEmotesOpen((o) => !o)}
      >
        <span aria-hidden="true">🎭</span>
        Emotes
      </button>
      {emotesOpen && (
        <div className="jm-bar__emotes" role="menu" aria-label="Emotes">
          {EMOTE_ROW.map((e) => (
            <button
              key={e}
              className="jm-emoji__btn"
              type="button"
              role="menuitem"
              aria-label={`Send emote ${e}`}
              onClick={() => onSendEmote(e)}
            >
              {e}
            </button>
          ))}
          <button
            className="jm-btn jm-btn--icon"
            type="button"
            aria-label="Close emote picker"
            onClick={() => setEmotesOpen(false)}
          >
            ✕
          </button>
        </div>
      )}

      <button className="jm-btn" type="button" onClick={() => void copyInvite()}>
        <span aria-hidden="true">{copied ? '✅' : '🔗'}</span>
        {copied ? 'Copied!' : 'Invite'}
      </button>

      <button
        className="jm-btn"
        type="button"
        aria-pressed={settings.deafened}
        onClick={() => store.setSettings({ deafened: !settings.deafened })}
        title={settings.deafened ? 'Undeafen (hear audio again)' : 'Deafen (hear nothing; mic unchanged)'}
      >
        <span aria-hidden="true">🎧</span>
        {settings.deafened ? 'Deafened' : 'Deafen'}
      </button>

      <label className="jm-bar__vol">
        Volume
        <input
          className="jm-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          aria-label="Master volume"
          value={masterToSlider(settings.masterVolume)}
          onChange={(e) => store.setSettings({ masterVolume: sliderToMaster(e.target.valueAsNumber) })}
        />
      </label>

      <button
        className="jm-btn"
        type="button"
        aria-pressed={sidebarOpen && activeTab === 'chat'}
        onClick={() => onToggleTab('chat')}
      >
        <span aria-hidden="true">💬</span>
        Chat
        {unreadChat > 0 && <span className="jm-bar__badge">{unreadChat > 99 ? '99+' : unreadChat}</span>}
      </button>

      <button
        className="jm-btn"
        type="button"
        aria-pressed={sidebarOpen && activeTab === 'people'}
        onClick={() => onToggleTab('people')}
      >
        <span aria-hidden="true">👥</span>
        People
      </button>

      <button className="jm-btn" type="button" onClick={onOpenSettings}>
        <span aria-hidden="true">⚙️</span>
        Settings
      </button>

      <button className="jm-btn jm-btn--danger" type="button" onClick={onLeave}>
        <span aria-hidden="true">🚪</span>
        Leave
      </button>

      <span className="jm-bar__zone">📍 {localZone ? localZone.label ?? localZone.id : 'Open map'}</span>
    </div>
  );
}
