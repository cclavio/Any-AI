---
name: plan-feature
description: This skill should be used when the user wants to plan a new feature, draft an implementation plan, describe changes they want to make, or says "plan a feature", "let's plan", "I want to add", "new feature", "draft a plan". Handles the full pipeline from idea capture through structured plan generation, review, and promotion to ready.
version: 1.0.0
---

# Plan Feature — Any AI

Turn unstructured feature ideas into structured, audited implementation plans ready for the build-feature skill.

## When This Skill Applies

- User says "plan a feature", "let's plan", "draft a plan", "new feature"
- User describes changes they want in stream-of-consciousness format
- User says "I want to add...", "we should build...", "here's what I'm thinking..."
- User provides a list of changes, updates, or feature ideas

## Workflow

### Phase 1: Capture & Clarify

1. **Listen to the user's description** — they will provide ideas in unstructured, stream-of-consciousness format. Do not interrupt the flow.
2. **Organize the ideas**: Group related concepts, identify the core feature vs. nice-to-haves, note any implicit dependencies
3. **Investigate the codebase**:
   - Read files relevant to the described feature
   - Check `src/server/db/schema.ts` for existing tables/columns that might be affected
   - Check existing managers, agents, and routes that the feature would touch
   - Look at `MIGRATIONS.md` for the next migration number
   - Review `package.json` for relevant existing dependencies
4. **Research external APIs/SDKs** if the feature involves:
   - New third-party integrations — use Context7 MCP or WebSearch to look up docs
   - New AI SDK patterns — check current Vercel AI SDK docs
   - New MentraOS SDK capabilities — check `@mentra/sdk` types
5. **Ask clarifying questions** — identify ambiguities, missing details, or decision points. Present questions grouped logically, not one at a time. Include your recommendation for each question when you have one.
6. **Ask about priority** if not already stated by the user: `critical`, `high`, `normal`, or `low`

### Phase 2: Draft Plan

1. **Write the first draft** to `.plans/draft-<feature-name>.md` using the plan file format below
2. **Present a summary** to the user highlighting:
   - Feature scope and what it accomplishes
   - Files that will be created or modified
   - Database changes (if any)
   - Key architectural decisions made
   - Any assumptions or trade-offs
3. **Wait for user review** — the user will provide feedback, ask questions, or request changes

### Phase 3: Iterate

1. **Integrate feedback** — update the plan file with the user's changes
2. **Answer questions** — explain reasoning behind decisions, propose alternatives if the user is unsure
3. **Repeat** until the user is satisfied with the plan
4. Multiple rounds of feedback are normal and expected — don't rush to finalize

### Phase 4: Finalize

1. **Confirm priority** — if priority wasn't established in Phase 1, ask now before promoting
2. **Final review** — present the complete plan one last time for the user's explicit approval
3. **Wait for explicit confirmation** — the user must say the plan is ready (e.g., "looks good", "approved", "promote it", "ready")
4. **Promote the plan**: Rename from `draft-<feature-name>.md` to `ready-<feature-name>.md`
5. **Confirm** — tell the user the plan is now in the ready backlog and can be picked up by the build-feature skill

## Plan File Format

Every plan must follow this structure:

```markdown
# Plan: <Feature Name>

## Priority
critical | high | normal | low

## Summary
One paragraph describing the feature and what it accomplishes.

## Context
Why this feature is needed, what problem it solves, and any relevant background.
Reference existing behavior that will change or be extended.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `path/to/new-file.ts` | **New** — description |
| 2 | `path/to/existing-file.ts` | **Modify** — description of changes |

## Database Changes

If the feature requires schema changes, include:
- Migration SQL (with the next sequential migration number from MIGRATIONS.md)
- Drizzle schema updates
- RLS policies if new tables are created
- Note: skip this section entirely if no DB changes needed

## Detailed Changes

### 1. `filename.ts` (new/modify)

Describe the changes in detail. Include:
- Key types/interfaces being added
- Function signatures
- Important logic
- Code snippets for non-obvious patterns

Repeat for each file.

## Execution Order

Numbered list of implementation steps in dependency order.
Group steps that can be done in parallel.
Note any steps that block subsequent work.

## Verification

Numbered list of how to verify the feature works:
1. Specific test scenarios
2. Expected behaviors
3. Edge cases to check
4. `npx tsc --noEmit` passes clean
```

## Guidelines for Plan Quality

### Be Specific
- Include exact file paths, not just descriptions
- Show function signatures and key types
- Specify migration SQL, not just "add a column"
- Reference existing patterns in the codebase when the new code should follow them

### Be Realistic
- Check that files the plan references actually exist and haven't moved
- Verify function signatures match current code, not assumptions
- Account for existing features that might interact with the new one
- Use the next available migration number

### Be Minimal
- Only include changes that are necessary for the feature
- Don't bundle unrelated improvements or refactors
- Don't add speculative "nice to have" items unless the user requested them
- Prefer modifying existing files over creating new ones when practical

### Match Project Patterns
- Follow existing code patterns (see CLAUDE.md for conventions)
- Use Drizzle ORM for database, AI SDK v6 for AI calls
- Use `maxOutputTokens` not `maxTokens` for AI SDK
- Match existing naming conventions (camelCase for TS, snake_case for DB columns)
- Regex classifiers follow the `device-commands.ts` / `conversational-closers.ts` pattern
- New managers follow the existing Manager class pattern

## Important Rules

- Never skip codebase investigation — plans based on assumptions go stale immediately
- Always save the draft to `.plans/` even if it needs more iteration — this prevents losing work across sessions
- Ask clarifying questions in batches, not one at a time
- Include your recommendation with every question when you have one
- Do NOT promote to `ready-` without explicit user confirmation
- Do NOT skip the priority question — every plan needs a priority before promotion
- If the user describes multiple unrelated features, suggest splitting into separate plans
