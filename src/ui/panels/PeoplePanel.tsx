/**
 * People panel (SPEC §5.4/§7.7/§8.5/§9.3). Props contract:
 * { localId, notices } — `notices` carries the §9.3 stage-share queue /
 * "X is sharing in <zone>" strings computed by the Room.
 */

import { store } from '../../store';
import { useStore } from '../hooks';
import { POSELESS_LABEL, peopleStatusLabel, sliderToVolume, volumeToSlider } from '../util';

export interface PeoplePanelProps {
  localId: string | null;
  notices: readonly string[];
}

export function PeoplePanel({ localId, notices }: PeoplePanelProps) {
  const snap = useStore();
  const zones = store.zones();
  const now = Date.now();
  const others = snap.participants.filter((p) => p.id !== localId);

  return (
    <div className="jm-people">
      {notices.map((n, i) => (
        <p className="jm-people__notice" key={`${i}:${n}`}>
          {n}
        </p>
      ))}
      {others.length === 0 && <p className="jm-chat__empty">Nobody else is here yet.</p>}
      {others.map((p) => {
        const status = peopleStatusLabel(p, snap.local.pose, zones, now);
        return (
          <div className="jm-person" key={p.id}>
            <div className="jm-person__head">
              <span className="jm-person__avatar" aria-hidden="true">
                {p.avatar.emoji}
              </span>
              <div className="jm-person__who">
                <div className="jm-person__name">{p.name || 'Guest'}</div>
                <div
                  className={
                    status === POSELESS_LABEL ? 'jm-person__status jm-person__status--poseless' : 'jm-person__status'
                  }
                >
                  {status}
                </div>
              </div>
              <div className="jm-person__icons">
                <span
                  role="img"
                  title={p.micMuted ? 'Microphone muted' : 'Microphone on'}
                  aria-label={p.micMuted ? 'Microphone muted' : 'Microphone on'}
                >
                  {p.micMuted ? '🔇' : '🎙️'}
                </span>
                <span
                  role="img"
                  title={p.camMuted ? 'Camera off' : 'Camera on'}
                  aria-label={p.camMuted ? 'Camera off' : 'Camera on'}
                >
                  {p.camMuted ? '📷' : '📹'}
                </span>
                {p.hasDesktop && <span title="Sharing their screen">🖥️</span>}
              </div>
            </div>
            <div className="jm-person__controls">
              <label className="jm-person__vol">
                Volume
                <input
                  type="range"
                  className="jm-slider"
                  min={0}
                  max={200}
                  step={5}
                  aria-label={`Volume for ${p.name || 'participant'}`}
                  value={volumeToSlider(p.volume)}
                  onChange={(e) =>
                    store.setParticipantControls(p.id, { volume: sliderToVolume(e.target.valueAsNumber) })
                  }
                />
                <span>{volumeToSlider(p.volume)}%</span>
              </label>
              <button
                className="jm-btn jm-person__mute"
                type="button"
                aria-pressed={p.mutedForMe}
                onClick={() => store.setParticipantControls(p.id, { mutedForMe: !p.mutedForMe })}
              >
                {p.mutedForMe ? 'Unmute' : 'Mute'}
              </button>
            </div>
            <p className="jm-person__hint">Mute is client-side — it only affects you.</p>
          </div>
        );
      })}
    </div>
  );
}
