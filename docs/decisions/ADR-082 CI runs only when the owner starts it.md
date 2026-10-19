# ADR-082: CI runs only when the owner starts it

**Date:** 2026-10-19. **Status:** accepted.

## Context

CI (`.github/workflows/ci.yml`) ran the gates on every push to main and
every pull request: a Linux job for the type check and unit tests, and a
Windows job for Rust's fmt, clippy and tests. Hosted runners cost the
owner money, Windows minutes most of all, and agents push large merges
that the gates have already passed locally. The owner wants CI to run only
when they choose to run it, and the website deploy to stay automatic.

## Decision

- **`ci.yml` has one trigger, `workflow_dispatch`.** The owner starts it
  from Actions > CI > Run workflow. No push, pull request or schedule
  starts it.
- **Agents never start CI.** They don't dispatch it, re-run it, or add
  triggers back. They run the same gates locally before committing
  (CLAUDE.md, rule 3).
- **The Pages deploy (`pages.yml`, ADR-077) stays the one automatic
  workflow,** on changes to the site, the docs it renders, or itself.

## Consequences

- A pull request shows no checks until the owner runs CI. Contributors are
  asked to run `just check` themselves (CONTRIBUTING.md).
- A green main depends on the local gates, which every commit body
  records, and on the owner's runs when they want a second opinion.
