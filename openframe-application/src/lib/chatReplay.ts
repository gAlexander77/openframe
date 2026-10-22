/** Chat stays in source seconds, independent of the timeline's frame rate. */
export interface ChatMessage { time: number; text: string }

const record = (x: unknown): Record<string, unknown> => x && typeof x === "object" ? x as Record<string, unknown> : {};

/** TwitchDownloader/Twitch, chat-downloader JSON (array or JSONL), or timestamped text. */
export function parseChatReplay(text: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  const add = (value: unknown) => {
    const row = record(value), message = record(row.message);
    const time = row.content_offset_seconds ?? row.time_in_seconds;
    const body = typeof row.message === "string" ? row.message : message.body ?? (Array.isArray(message.fragments) ? message.fragments.map(x => String(record(x).text ?? "")).join("") : undefined);
    if (typeof time === "number" && Number.isFinite(time) && time >= 0 && typeof body === "string") out.push({ time, text: body });
  };
  try {
    const json: unknown = JSON.parse(text);
    const rows = Array.isArray(json) ? json : record(json).comments;
    if (Array.isArray(rows)) rows.forEach(add);
    else add(json); // A JSONL replay containing just one message.
  } catch {
    for (const line of text.split(/\r?\n/)) {
      try { add(JSON.parse(line)); continue; } catch { /* A text replay, or a malformed line. */ }
      const m = line.match(/^\s*\[?(\d+):(\d{2})(?::(\d{2}))?\]?\s+(?:<[^>]+>|[^:]+:)\s*(.*)$/);
      if (!m || +m[2] >= 60 || (m[3] !== undefined && +m[3] >= 60)) continue;
      const time = m[3] === undefined ? +m[1] * 60 + +m[2] : +m[1] * 3600 + +m[2] * 60 + +m[3];
      if (Number.isFinite(time)) out.push({ time, text: m[4] });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Emote repetition and explicit clip requests are useful even without a rate spike. */
export function chatCue(text: string): number {
  const words = text.toUpperCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const repeated = words.length - new Set(words).size;
  return Math.min(1, (words.filter(w => /^(LUL|KEKW|OMEGALUL|POG|POGGERS|W|LMAO)$/.test(w)).length + repeated) / 4 + (/\bclip\b/i.test(text) ? 0.7 : 0));
}
