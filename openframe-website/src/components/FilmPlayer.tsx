// The hero: the launch film over its own timeline. Chapters are clips on a
// picture track, the music's sections a track below, and a playhead follows
// the film; choosing a chapter plays from there. The video keeps the
// browser's own controls, so it works before this hydrates and with any
// input method.
import { useEffect, useRef, useState } from "react";
import playSvg from "../icons/play.svg?raw";
import type { Chapter, Section } from "../data/film";

type Props = {
  src: string;
  poster: string;
  captions: string;
  duration: number;
  chapters: Chapter[];
  music: Section[];
  title: string;
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const pct = (s: number, d: number) => `${(s / d) * 100}%`;

export default function FilmPlayer({ src, poster, captions, duration, chapters, music, title }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [started, setStarted] = useState(false);
  // The browser's controls show until this hydrates (so the film plays
  // without script), then hide behind the big play button until it starts.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let raf = 0;
    const place = () => {
      const t = v.currentTime;
      if (head.current) head.current.style.transform = `translateX(${(t / duration) * 100}cqw)`;
      const i = chapters.findIndex((c) => t >= c.start && t < c.end);
      setCurrent(i < 0 ? chapters.length - 1 : i);
    };
    const tick = () => {
      place();
      if (!v.paused && !v.ended) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setStarted(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("seeked", place);
    v.addEventListener("timeupdate", place);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("seeked", place);
      v.removeEventListener("timeupdate", place);
    };
  }, [chapters, duration]);

  const playFrom = (s: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = s;
    void v.play().catch(() => undefined);
  };

  const ticks = Array.from({ length: Math.floor(duration / 4) + 1 }, (_, i) => i * 4);
  const now = chapters[current];

  return (
    <div className="film">
      <div className="film-frame">
        <video ref={video} controls={!hydrated || started} preload="none" playsInline poster={poster} width={1920} height={1080} aria-label={title}>
          <source src={src} type="video/mp4" />
          <track kind="captions" srcLang="en" label="English (music and sound)" src={captions} />
        </video>
        {hydrated && !started && (
          <button type="button" className="film-play" onClick={() => playFrom(0)} aria-label={`Play the ${title}, ${duration} seconds, with sound`}>
            <span className="film-play-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: playSvg }} />
            <span className="film-play-text">
              Play the film <span className="film-play-len">0:{String(duration).padStart(2, "0")}, sound on</span>
            </span>
          </button>
        )}
      </div>

      <div className="film-timeline">
        <div className="film-labels" aria-hidden="true">
          <span>Picture</span>
          <span>Music</span>
        </div>
        <div className="film-lanes">
          <div className="film-ruler" aria-hidden="true">
            {ticks.map((s) => (
              <span key={s} className={s % 8 === 0 ? "tick major" : "tick"} style={{ left: pct(s, duration) }}>
                {s % 8 === 0 && s < duration ? clock(s) : ""}
              </span>
            ))}
          </div>
          <ol className="film-track picture" aria-label="Chapters of the film">
            {chapters.map((c, i) => (
              <li key={c.start} style={{ left: pct(c.start, duration), width: pct(c.end - c.start, duration) }}>
                <button
                  type="button"
                  className={`chapter hue-${c.hue}`}
                  aria-current={i === current && started ? "true" : undefined}
                  aria-label={`${c.label}, from ${clock(c.start)}`}
                  title={`${c.label} (${clock(c.start)})`}
                  onClick={() => playFrom(c.start)}
                >
                  <span>{c.label}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="film-track music" aria-hidden="true">
            {music.map((m) => (
              <span
                key={m.start}
                className="cue"
                title={`${m.label}, ${m.lufs} LUFS`}
                style={{ left: pct(m.start, duration), width: pct(m.end - m.start, duration), ["--level" as string]: Math.min(1, Math.max(0.15, (m.lufs + 24) / 12)) }}
              >
                <span>{m.label}</span>
              </span>
            ))}
          </div>
          <div className="film-playhead" ref={head} aria-hidden="true" />
        </div>
      </div>
      <p className="film-now">
        <span className={`dot hue-${now.hue}`} aria-hidden="true" />
        <strong>{clock(now.start)}</strong> {now.text}
      </p>
    </div>
  );
}
