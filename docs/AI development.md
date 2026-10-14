# AI development and documentation

## The experiment

OpenFrame began as an experiment in autonomously developing a fully open
video editor with **Claude Code and Codex**. The project implementation was
developed using AI coding agents; the human owner provided the product
direction, feedback, and decisions about what to keep. This records the
development method, rather than claiming that the project is finished or
that generated work is automatically correct.

The goal is a desktop-first editor anyone can use, inspect, modify, and
redistribute under GPL-3.0-only. A secondary browser version shares the core
and runs on the user's device. Third-party dependencies and models remain
the work of their respective authors, with their own licenses.

AI used to develop the project is separate from AI inside the editor.
Copilot, local analysis, captions, and agent automation are product features
documented in [[AI tools]] and [[Automation]]. Users do not need Claude Code
or Codex to perform ordinary manual editing.

## Why the documentation exists

| Reader | What the documentation provides |
|---|---|
| Users | A first editing session, storage behavior, feature explanations, and current limitations. |
| Contributors | Architecture, conventions, reproducible validation, priorities, and the reasons for design choices. |
| AI agents | Persistent context across sessions: owner intent, constraints, accepted decisions, current work, and lessons learned. |

The documentation is the project's shared working memory. It lets a new
contributor or resumed agent understand why the code has its current shape
without reconstructing every earlier conversation.

## How agents use it

Start with the root `AGENTS.md`, the shared `CLAUDE.md` operating manual,
[[Next agent handoff]], and [[Index]]. Read the architecture and ADRs relevant
to the task before changing an interface. Use research notes to understand
the alternatives, tests and drive scripts to verify behavior, and history
to avoid repeating failures.

Agents should update the records when the implementation or evidence
changes. Existing research is background evidence, not a substitute for
checking the current code or current upstream requirements. The owner's
current instructions take precedence over earlier plans.

## What belongs where

- **User guide and Features:** instructions and behavior that exist today.
- **Roadmap:** pending work and proposals, with uncertainty stated.
- **Architecture and Project format:** contracts that match the source.
- **ADRs:** decisions, alternatives, and consequences. Retain historical
  decisions and add a dated follow-up when direction changes.
- **Research:** source links, observations, and assumptions behind choices.
- **History:** lessons and verification outcomes worth keeping.
- **Next agent handoff:** the current pickup order and constraints.

Record the tested revision, platform, workflow, and result when reporting
new verification. Distinguish observations from assumptions. Never turn a
plan into a shipped feature, or an old result into a fresh test pass.
Keep secrets and private user media out of the docs. Use concise context
and source references instead of copying entire agent conversations.

## Current owner decisions - 2026-10-14

- Product name: **OpenFrame**. The coordinated implementation rename is
  pending; the current repository is `gAlexander77/video-editor`.
- License: **GPL-3.0-only** for original project code and documentation.
- Development: **desktop first**, with browser support verified separately.
- Visibility: keep the repository private until the owner requests release.
- Continuity: leave paused Claude Code work and existing worktrees intact.

See [[Renaming]] and [[Release preparation]] for the concrete remaining work.
