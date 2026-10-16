import { useState } from "react";
import { editFolder } from "../lib/project/mediaOrganization";
import { store, useEditor } from "../state/store";

export function MediaFolders() {
  const folders = useEditor((s) => s.project.mediaFolders);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const apply = (action: "create" | "rename" | "delete") => {
    try {
      store.edit(`${action} media folder`, (p) => editFolder(p, action, action === "create" ? name : selected, name));
      setSelected(""); setName(""); setError("");
      // A renamed/deleted folder must not leave an invisible active filter.
      const browser = store.get().mediaBrowser;
      if (action !== "create" && browser.folder === selected) store.set({ mediaBrowser: { ...browser, folder: action === "delete" ? null : name.trim() } });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <details className="folder-editor"><summary>Organize folders</summary>
    <p className="lib-hint">Folders organize this project. Source files stay in place. Deleting a folder returns its media to Unfiled.</p>
    <div className="folder-controls">
      <select className="field" aria-label="Folder to manage" value={selected} onChange={(e) => { setSelected(e.target.value); setName(e.target.value); }}><option value="">New folder</option>{folders?.map((f) => <option key={f}>{f}</option>)}</select>
      <input className="field" aria-label="Folder name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Folder name" />
      <button className="btn" disabled={!name.trim()} onClick={() => apply(selected ? "rename" : "create")}>{selected ? "Rename folder" : "Create folder"}</button>
      {selected && <button className="btn ghost" onClick={() => apply("delete")}>Delete folder</button>}
    </div>
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </details>;
}
