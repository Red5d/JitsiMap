/**
 * "Click to enable audio" banner — SPEC §8.6. Shown while the AudioContext is
 * not 'running' after join; clicking it (a user gesture) resumes the context.
 */

export interface AudioBannerProps {
  onEnable: () => void;
}

export function AudioBanner({ onEnable }: AudioBannerProps) {
  return (
    <button className="jm-banner" type="button" onClick={onEnable}>
      🔇 Audio is paused by the browser — click to enable audio
    </button>
  );
}
