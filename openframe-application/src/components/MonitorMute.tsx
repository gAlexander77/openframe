import { Volume2, VolumeX } from "../icons";
import { run, tipFor } from "../state/actions";
import { useEditor } from "../state/store";

export function MonitorMute() {
  const muted = useEditor((s) => s.monitorMuted);
  return <button className={`icon-btn${muted ? " on" : ""}`} aria-label="Mute playback" aria-pressed={muted} data-tip={tipFor("mutePlayback")} onClick={() => run("mutePlayback")}>
    {muted ? <VolumeX /> : <Volume2 />}
  </button>;
}
