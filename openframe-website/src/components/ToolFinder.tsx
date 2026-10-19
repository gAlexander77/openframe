// Find an MCP tool by name or by what it does. The full reference is static
// HTML below this on the page; this is its live index.
import { useId, useMemo, useState } from "react";

type Tool = { name: string; summary: string };
type Group = { name: string; id: string; tools: Tool[] };

export default function ToolFinder({ groups, total }: { groups: Group[]; total: number }) {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, tools: q ? g.tools.filter((t) => t.name.includes(q.replace(/\s+/g, "_")) || t.summary.toLowerCase().includes(q)) : g.tools }))
        .filter((g) => g.tools.length),
    [groups, q],
  );
  const count = shown.reduce((a, g) => a + g.tools.length, 0);
  return (
    <div className="finder">
      <label htmlFor={inputId} className="finder-label">Find a tool by name or by what it does</label>
      <input
        id={inputId}
        type="search"
        className="finder-input"
        placeholder="captions, beat, loudness, export..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <p className="finder-count" role="status">
        {q ? `${count} of ${total} tools match` : `${total} tools in ${groups.length} groups`}
      </p>
      <div className="finder-groups">
        {shown.map((g) => (
          <section key={g.id} className="finder-group" aria-label={g.name}>
            <h3 className="finder-group-name">
              <a href={`#${g.id}`}>{g.name}</a> <span>{g.tools.length}</span>
            </h3>
            <ul className={q ? "finder-list detailed" : "finder-list"}>
              {g.tools.map((t) => (
                <li key={t.name}>
                  <a href={`#${t.name}`}>
                    <code>{t.name}</code>
                    {q && <span>{t.summary}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!count && <p className="finder-none">No tool matches “{query}”. Try a shorter word, or a verb such as add, set or export.</p>}
      </div>
    </div>
  );
}
