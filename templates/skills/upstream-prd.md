---
name: upstream-prd
description: Creates a PRD via import, interactive interview, auto-draft, or link. Invoked by upstream-guard or directly.
---

You are creating a Product Requirements Document (PRD).

**Setup before any mode:**

1. Read `upstream.config.yaml` → get `docs_path` (default: `docs/upstream/`) and `prd_required_fields`.
2. Read template from `.claude/plugins/upstream/templates/PRD.md`.
3. Get current branch: `git rev-parse --abbrev-ref HEAD`
4. Derive slug: last segment after `/`, lowercase, `_` → `-`. Example: `feat/user-auth` → `user-auth`.

You will be invoked with a mode: `import`, `interview`, `auto-draft`, or `link`.

---

## Mode: import

Say: "Great. Paste your existing document, or describe it in as much detail as you have. It doesn't need to be formatted."

Wait for their input. Then:

1. Map their content to the PRD template fields.
2. For each field in `prd_required_fields` not covered, ask specifically: "Your document doesn't cover **[field_name]**. Can you tell me: [natural-language version of the field]?"
3. Assemble the complete PRD from the template.
4. Show it and say: "Here's the PRD. Anything to adjust?" Apply feedback.
5. Save (see Saving section).

---

## Mode: interview

Conduct a structured interview — one question at a time, wait for each answer.

**Q1:** "What problem does this feature solve? Be specific — who experiences it, and what's the current workaround or pain?"

*(After answer)*

**Q2:** "What does success look like? How will you know this is working? (Metrics, user behavior, or observable outcomes)"

*(After answer)*

**Q3:** "What is explicitly out of scope for this version? What are you deferring?"

*(After answer — check `prd_required_fields`. If additional required fields exist beyond these three, ask them one at a time. Then:)*

**Q-final:** "Any technical constraints, external dependencies, or known risks to include?"

After the last answer: "Thanks — let me put this together."

Assemble the PRD from the template with answers filled in. Show it: "Here's the PRD. Anything to adjust?" Apply feedback, then save.

---

## Mode: auto-draft

1. Run `git log --oneline -10` and `git diff --stat HEAD~3..HEAD 2>/dev/null || echo "no prior commits"`.
2. Generate a complete PRD draft from: the user's original prompt, the branch name, and the git context.
3. Show the draft: "Here's my draft PRD. Let me know what to change, or say 'looks good' to save."
4. Apply feedback until approved. Save.

---

## Mode: link

Ask: "What's the URL for your PRD? (Notion, Confluence, Google Docs, or any other tool)"

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
If `result.title` is null: ask "What's the title of this document?" (use branch slug as fallback if skipped).

Read `.claude/plugins/upstream/templates/PRD-link.md` and fill in: title, URL, branch, date.

Save the stub (see Saving). Do not ask further questions after title is resolved.

---

## Saving

If mode is `link`: read template from `.claude/plugins/upstream/templates/PRD-link.md`, fill fields, save stub.
Otherwise: save full PRD content.

Save to: `<docs_path>/PRD-<slug>.md`

After saving, say: "PRD saved to `<docs_path>/PRD-<slug>.md`."

If invoked from upstream-guard, add: "Returning to upstream-guard to check ADR requirements."

