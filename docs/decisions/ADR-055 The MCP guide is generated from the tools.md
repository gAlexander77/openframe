# ADR-055: The MCP guide is generated from the tools

**Date:** 2026-10-18. **Status:** accepted.

## Context

The owner wants any AI model to make a professional ad or epic edit
through the MCP tools, and the documentation to be clear enough that
the model knows how to use each one. Before this, a model saw:
- 110 tool names with their schemas;
- a nine-line instructions string;
- a `list_catalog` that named only effects, transitions, filters and
  animations.

Templates, looks, sound effects, fonts, speed presets, blend modes and
the `set_param` paths existed but could not be discovered. Nothing told a
model what a good ad or edit looks like.

Documentation written by hand next to 110 tools drifts the day a tool
changes.

## Decision

- **One source:** `src/lib/mcpGuide.ts`.
  - It files every tool in a group, in the order a video gets made.
  - It gives each tool MCP's `title` and behavior hints (`readOnlyHint`,
    `destructiveHint`, `openWorldHint`; spec 2025-06-18), so clients can
    run reads without asking.
  - It holds worked examples for the tools that are easy to get wrong.
  - It holds the full catalog and the playbooks: an ad, an epic edit, a
    social short, and the design rules from
    [[Pro workflows 2026-10-18]].
- **Served four ways,** for every kind of client:
  - The `help` tool, for clients that only use tools: an overview, a
    playbook, the design rules, the `set_param` paths, or any tool's
    parameters with an example.
  - MCP prompts: `make_ad`, `epic_edit` and `social_short`, with the
    user's details filled in.
  - Resources: `guide://overview`, `guide://design`, `guide://ad` and
    the other guides, plus `catalog://all`.
  - The server's `instructions` on initialize, which name all of these.
- **Generated docs:** [[MCP tools]] and [[Agent playbook]] are generated
  from the same code. A test fails `npm test` when either is out of date,
  when a tool is not filed in a group, or when an example does not pass
  its tool's own schema. `UPDATE_MCP_DOCS=1 npx vitest run
  src/lib/mcpGuide.test.ts` rewrites them.
- **Nested parameters get their own rows** in the reference (`style.size`,
  `files[].src`): that is where models guess wrong.

## Consequences

- A new tool shows up in the reference only once it is filed in a group,
  so whoever adds a tool also decides where a model will look for it.
- Examples are checked against schemas, not run. A wrong id is fine; a
  wrong field name fails the test. That is how the first `batch` example,
  written with `name` instead of `command`, was caught.
- The playbooks are advice in text. A model can still ignore them; a
  design check tool that measures the result is the complement.
