---
name: upstream-adr
description: Creates an ADR via import, interactive interview, auto-draft, or link. Invoked by upstream-guard when an architectural decision is detected.
---

You are creating an Architecture Decision Record (ADR).

**Setup before any mode:**

1. Read `upstream.config.yaml` → get `docs_path` (default: `docs/upstream/`).
2. Read template from `.claude/plugins/upstream/templates/ADR.md`.
3. Find next ADR number: list `<docs_path>/ADR-*.md`, extract the highest NNN from filenames, add 1. If none exist, start at 1. Zero-pad to 3 digits (001, 002...).
4. Get current branch: `git rev-parse --abbrev-ref HEAD`
5. Derive slug: last segment after `/`, lowercase, `_` → `-`.
6. Read `<docs_path>/PRD-<slug>.md` if it exists (for context).

You will be invoked with a mode (`import`, `interview`, `auto-draft`, or `link`) and a trigger reason.

---

## Mode: import

Say: "Please paste or describe your existing architecture decision document."

Map content to template fields. For uncovered fields, ask:

- "What alternatives did you consider?"
- "What are the trade-offs of the chosen approach vs. alternatives?"
- "What are the consequences — what gets easier, what gets harder?"

Assemble, show for review, apply feedback, save.

---

## Mode: interview

One question at a time.

**Q1:** "What is the architectural decision being made? Try stating it as: 'We will use X instead of Y for Z.'"

*(After answer)*

**Q2:** "What alternatives did you evaluate? List them briefly."

*(After answer)*

**Q3:** "Why did you choose your approach over the alternatives? What are the trade-offs?"

*(After answer)*

**Q4:** "What are the consequences of this decision? What gets easier? What gets harder? Any risks?"

Assemble ADR, show for review: "Here's the ADR. Anything to adjust?" Apply feedback, save.

---

## Mode: auto-draft

Generate from: the trigger reason, PRD content, branch name, and `git log --oneline -5`.

Show draft: "Here's my draft ADR for **[trigger reason]**. Let me know what to change, or say 'looks good' to save."

Apply feedback, save.

---

## Mode: link

Ask: "What's the URL for your ADR? (Notion, Confluence, Google Docs, or any other tool)"

Wait for the URL. Then:

1. Call the `validate_link` MCP tool with the URL.
2. Read `link_policy` from `upstream.config.yaml`.

**Policy checks (run before saving):**

If `link_policy.allowed_providers` is set AND the result `provider` is not in the list:
> Block: "This org only accepts links from: [allowed_providers]. Please provide a URL from one of those tools."

If `link_policy.require_validation` is true AND `result.error` is not null:
> Block: "This org requires validated links. [result.error]. Please resolve before continuing."
> (If error is "not authenticated", tell them: "Run `upstream auth google-docs` and try again.")

**After policy checks pass:**

If `result.title` is available: use it as the document title (do not ask the user).
If `result.last_edited` is available: use it as the date field.
If `result.title` is null: ask "What's the title of this ADR?" (use branch slug + trigger reason as fallback if skipped).

Read `.claude/plugins/upstream/templates/ADR-link.md` and fill in: title, URL, branch, date, trigger reason.

Save the stub (see Saving). Do not ask further questions after title is resolved.

---

## Saving

If mode is `link`: read template from `.claude/plugins/upstream/templates/ADR-link.md`, fill fields, save stub.
Otherwise: save full ADR content.

Save to: `<docs_path>/ADR-<NNN>-<slug>.md`

After saving: "ADR saved to `<docs_path>/ADR-<NNN>-<slug>.md`."

If invoked from upstream-guard: "Returning to upstream-guard."
