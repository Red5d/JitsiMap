/**
 * Settings panel (SPEC §5.4/§8.5/§8.6).
 * Props contract: { client, onClose }.
 * Rendered by the Room inside `.jm-modal` (backdrop + card chrome live there);
 * this component renders the `.jm-settings` card content.
 */

import { useEffect, useState } from 'react';

import type { JitsiClient } from '../../jitsi/api';
import { store } from '../../store';
import type { AudioTier } from '../../types';
import { useStore } from '../hooks';

export interface SettingsPanelProps {
  client: JitsiClient;
  onClose: () => void;
}

const TIERS: ReadonlyArray<{ id: AudioTier; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'full', label: 'Full pan + gain' },
  { id: 'gain', label: 'Gain-only' },
  { id: 'off', label: 'Off (flat volume)' },
];

export function SettingsPanel({ client, onClose }: SettingsPanelProps) {
  const { settings } = useStore();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let on = true;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => {
        if (on) setDevices(d);
      })
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, []);

  const info = client.describe();
  const ofKind = (kind: MediaDeviceKind) => devices.filter((d) => d.kind === kind);

  return (
    <div className="jm-modal__card jm-settings" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="jm-modal__head">
        <h2>Settings</h2>
        <button className="jm-btn" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <label className="jm-label" htmlFor="jm-set-mic">
        Microphone (applies on next join)
      </label>
      <select
        id="jm-set-mic"
        className="jm-select jm-settings__select"
        value={settings.audioDeviceId ?? ''}
        onChange={(e) => store.setSettings({ audioDeviceId: e.target.value || null })}
      >
        <option value="">System default</option>
        {ofKind('audioinput').map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || d.deviceId}
          </option>
        ))}
      </select>

      <label className="jm-label" htmlFor="jm-set-cam">
        Camera (applies on next join)
      </label>
      <select
        id="jm-set-cam"
        className="jm-select jm-settings__select"
        value={settings.videoDeviceId ?? ''}
        onChange={(e) => store.setSettings({ videoDeviceId: e.target.value || null })}
      >
        <option value="">System default</option>
        {ofKind('videoinput').map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || d.deviceId}
          </option>
        ))}
      </select>

      <label className="jm-label" htmlFor="jm-set-speaker">
        Speaker (live, where supported)
      </label>
      <select
        id="jm-set-speaker"
        className="jm-select jm-settings__select"
        value={settings.speakerDeviceId ?? ''}
        onChange={(e) => {
          const id = e.target.value || null;
          store.setSettings({ speakerDeviceId: id });
          if (id) client.setAudioOutput(id);
        }}
      >
        <option value="">System default</option>
        {ofKind('audiooutput').map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || d.deviceId}
          </option>
        ))}
      </select>

      <label className="jm-label" htmlFor="jm-set-tier">
        Spatial audio
      </label>
      <select
        id="jm-set-tier"
        className="jm-select jm-settings__select"
        value={settings.tier}
        onChange={(e) => store.setSettings({ tier: e.target.value as AudioTier })}
      >
        {TIERS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      <p className="jm-settings__info">
        {info
          ? `Room: ${info.conference} · You: ${info.participantId} · lib-jitsi-meet ${info.libVersion}`
          : 'Connection info unavailable.'}
      </p>

      <div className="jm-settings__actions">
        <span />
        <button className="jm-btn jm-btn--primary" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
