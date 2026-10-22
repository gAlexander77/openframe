import { expect, it } from "vitest";
import { escapeXml, parseXml } from "./xml";
it("reads nested elements, comments, quoted attributes and the five XML entities", () => {
  expect(parseXml(`<?xml version="1.0"?><!DOCTYPE fcpxml><fcpxml><!-- comment --><clip name='${escapeXml('A & "B" <C>')}'/><marker value="&#x1f3ac;&#65;"/></fcpxml>`)).toMatchObject({ tag: "fcpxml", children: [{ tag: "clip", attrs: { name: 'A & "B" <C>' } }, { attrs: { value: "🎬A" } }] });
});
it("rejects DTD entities, malformed trees and attributes", () => {
  for (const s of ['<!DOCTYPE fcpxml SYSTEM "file:///secret"><fcpxml/>', '<!DOCTYPE fcpxml [<!ENTITY a "boom">]><fcpxml/>', '<a x="&no;"/>', '<a x="1" x="2"/>', '<a><b></a>', '<a x=1/>', '<a/> <b/>', '<a>']) expect(() => parseXml(s), s).toThrow();
});
