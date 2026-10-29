/**
 * Stage panel (SPEC §9.3). Props contract: { participantId, onDismiss }.
 * The Room applies the §9.3 viewability rule + one-share-at-a-time queue;
 * this panel only renders the share and its dismiss control.
 */

import { useEffect, useRef } from 'react';

import { getTrackStream } from '../../jitsi/tracks';
import { useStore } from '../hooks';

export interface StagePanelProps {
  participantId: string;
  onDismiss: () => void;
}

export function StagePanel({ participantId, onDismiss }: StagePanelProps) {
  const { participants } = useStore();
  const sharer = participants.find((p) => p.id === participantId && p.desktopTrack);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = sharer ? getTrackStream(sharer.desktopTrack) : null;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    void el.play().catch(() => undefined);
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  if (!sharer) return null;

  return (
    <section className="jm-stage" aria-label={`${sharer.name || 'Someone'} is sharing their screen`}>
      <header className="jm-stage__head">
        <span>
          <span className="jm-stage__name">{sharer.name || 'Someone'}</span> is sharing their screen
        </span>
        <button className="jm-btn" type="button" onClick={onDismiss}>
          Close
        </button>
      </header>
      <video className="jm-stage__video" ref={videoRef} playsInline autoPlay muted />
    </section>
  );
}
