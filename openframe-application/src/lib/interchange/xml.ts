// A deliberately small XML tree reader: no DOM in the pure core, no DTD or
// external entities. FCPXML's empty DOCTYPE is accepted but never evaluated.
export interface XmlNode { tag: string; attrs: Record<string, string>; children: XmlNode[] }
export const escapeXml = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "�").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;");
const unescapeXml = (s: string) => {
  if (/&(?![\w#]+;)/.test(s)) throw new Error("Unescaped XML ampersand.");
  return s.replace(/&([^;]+);/g, (_, name: string) => {
    const entity: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (entity[name]) return entity[name];
    if (/^#(?:x[\da-f]+|\d+)$/i.test(name)) {
      const n = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)) return String.fromCodePoint(n);
    }
    throw new Error(`Unsupported XML entity &${name};`);
  });
};

export function parseXml(xml: string): XmlNode {
  if (xml.length > 32 * 1024 * 1024) throw new Error("Timeline XML exceeds 32 MiB.");
  const root: XmlNode = { tag: "document", attrs: {}, children: [] };
  const stack = [root];
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE\s+fcpxml\s*>|<\/?[A-Za-z_][\w:.-]*(?:\s+[^<>]*?)?\s*\/?>|[^<]+/g;
  let end = 0;
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== end) throw new Error("Malformed XML or unsupported DTD declaration.");
    const s = match[0]; end += s.length;
    if (s.startsWith("<?") || s.startsWith("<!")) continue;
    if (!s.startsWith("<")) { if (stack.length === 1 && s.trim()) throw new Error("Text outside the XML root."); unescapeXml(s); continue; }
    if (s.startsWith("</")) {
      if (stack.length < 2 || s.slice(2, -1).trim() !== stack.pop()!.tag) throw new Error("Mismatched XML closing tag.");
      continue;
    }
    const tag = /^<([\w:.-]+)/.exec(s)![1];
    const tail = s.slice(tag.length + 1).replace(/\/?\s*>$/, "");
    const attrs: Record<string, string> = Object.create(null);
    let consumed = 0;
    for (const a of tail.matchAll(/\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      if (a.index !== consumed || a[1] in attrs) throw new Error("Malformed or duplicate XML attribute.");
      attrs[a[1]] = unescapeXml(a[2] ?? a[3]); consumed += a[0].length;
    }
    if (tail.slice(consumed).trim()) throw new Error("Malformed XML attributes.");
    const node = { tag, attrs, children: [] };
    stack.at(-1)!.children.push(node);
    if (!s.endsWith("/>")) stack.push(node);
    if (stack.length > 64) throw new Error("XML nesting exceeds 64 levels.");
  }
  if (end !== xml.length || stack.length !== 1 || root.children.length !== 1) throw new Error("Incomplete XML document.");
  return root.children[0];
}
