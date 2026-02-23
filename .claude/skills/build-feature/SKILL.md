---
name: build-feature
description: This skill should be used when the user asks to "build a feature", "pick up a feature", "what's next", "work on the next feature", "implement next", or wants to select and build a ready feature from the backlog. Handles the full pipeline from plan selection through audit, development, and deploy.
version: 1.0.0
---

# Build Feature — Any AI

Select a ready feature from the backlog, audit the plan against the current codebase, and implement it.

## When This Skill Applies

- User says "build a feature", "pick up a feature", "what's next to build"
- User asks to work on or implement the next feature
- User asks to check the backlog or see what's ready
- User says "build-feature" or "/build-feature"

## Workflow

### Phase 1: Feature Selection

1. **List the backlog**: Run `ls .plans/` and identify all `ready-` prefixed plan files
2. **If no ready plans exist**: Report this to the user and ask if they want to draft a new plan or promote a `draft-` plan
3. **Read each ready plan's priority**: Each plan file should have a `## Priority` section with one of: `critical`, `high`, `normal`, `low`
4. **Present the selection**: Show the user a ranked list (critical first, then high, normal, low) with the feature name and a one-line summary from each plan
5. **Confirm selection**: Ask the user which feature to build, recommending the highest priority one. If only one ready plan exists, confirm it directly

### Phase 2: Plan Audit

The codebase has likely changed since the plan was written. The plan must be reconciled before implementation.

1. **Read the full plan file**
2. **Audit against current state**:
   - Read `src/server/db/schema.ts` — check if tables/columns the plan references still match
   - Read files the plan intends to modify — check if they've changed (new imports, renamed functions, different signatures)
   - Check `MIGRATIONS.md` — verify the plan's migration numbering doesn't conflict
   - Check `package.json` — verify any new dependencies the plan requires aren't already installed or conflicting
   - Run `npx tsc --noEmit` — ensure the codebase is clean before starting
3. **Document discrepancies**: List every difference between what the plan assumes and reality
4. **Update the plan file**: Edit the `.plans/ready-*.md` file to reflect the current codebase. Update file paths, line numbers, function signatures, migration numbers, import statements, and any other stale references
5. **Report the audit results**: Show the user what changed in the plan and confirm they're comfortable proceeding

### Phase 3: Development Strategy

Determine if the feature warrants single-agent or team development.

**Single agent** (default) — use when:
- The feature touches fewer than ~8 files
- Changes are primarily in one domain (backend only, frontend only, etc.)
- No parallelizable phases with different dependencies
- The plan has a single linear execution order

**Agent team** — use when:
- The feature spans multiple domains (backend + frontend + infra)
- There are parallelizable phases (e.g., backend and infra can start simultaneously)
- The plan has 3+ distinct phases with different skillsets
- Estimated scope is large (10+ files, multiple new modules)

Present the recommendation to the user and confirm before proceeding.

### Phase 4a: Single Agent Development

1. Work through the plan step by step
2. After completing each major section, run `npx tsc --noEmit` to verify
3. If the plan includes database migrations:
   - Create the migration SQL file
   - Update `src/server/db/schema.ts`
   - Apply via Supabase MCP
   - Update `MIGRATIONS.md`
4. Ask for user feedback at natural checkpoints or when making judgment calls
5. After all implementation is complete, run a final `npx tsc --noEmit`

### Phase 4b: Agent Team Development

1. **Write agent definition files** based on the plan's phases and domain breakdown
   - Create `.md` files in `.claude/agents/` for each agent role
   - Include: role description, critical rules, reference files to read, specific tasks, MCP servers to use
   - Reference the plan file by name as source of truth
   - Create a spawn prompt (e.g., `spawn-<feature>.md`) with the team structure and execution order
2. **Present the agent definitions** to the user for review before spawning
3. **Create the team** using the spawn prompt
4. **Coordinate execution** — the team lead (or this agent) manages the team through completion
5. After all agents complete, verify `npx tsc --noEmit` passes

### Phase 5: Wrap Up

1. **Rename the plan**: Change prefix from `ready-` to `complete-` in `.plans/`
2. **Archive agents** (if team was used): Move `.claude/agents/*.md` to `.plans/complete-<feature>-agents/`
3. **Run the deploy skill**: This handles README sync, typecheck, commit, push, Railway deploy, and memory pruning

## Plan File Format

Every `ready-` plan should include at minimum:

```markdown
# Plan: <Feature Name>

## Priority
critical | high | normal | low

## Summary
One paragraph describing the feature.

## Context
Why this feature is needed and what problem it solves.

## Files
| # | File | Action |
|---|------|--------|
| 1 | path/to/file.ts | New / Modify — description |

## Detailed Changes
...

## Execution Order
1. Step one
2. Step two
...

## Verification
1. How to verify the feature works
```

If a plan is missing the `## Priority` section, treat it as `normal` and add the section during audit.

## Important Rules

- Never skip the plan audit — the codebase changes between sessions
- Always typecheck before and after implementation
- Ask the user for feedback when making judgment calls or when the audit reveals significant plan changes
- Follow the plan as source of truth after audit, not memory from previous sessions
- Update `MIGRATIONS.md` for any database changes
- Use the deploy skill for the final commit/push/deploy — don't do it manually
