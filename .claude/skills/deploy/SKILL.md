---
name: deploy
description: This skill should be used when the user asks to "deploy", "push and deploy", "ship it", "commit and deploy", "release", or mentions deploying to Railway. Handles the full commit → push → Railway deploy workflow for the Any AI project.
version: 1.1.0
---

# Deploy — Any AI

Commit, push, and deploy the Any AI project to Railway in a single workflow.

## When This Skill Applies

- User says "deploy", "ship it", "push and deploy", "commit and deploy"
- User asks to release or deploy changes to production
- User asks to commit, push, and deploy in one step

## Workflow

### 1. Sync README.md

Before anything else, review the current `README.md` against recent changes:

- Check `git log --oneline -10` to see what features were added since the last README update
- If new features, tables, architecture changes, or workflow changes were implemented since the last README update, update the relevant sections
- Keep updates minimal and focused — only add/change what's actually new
- If README is already current, skip this step

### 2. Pre-flight checks

- Run `npx tsc --noEmit` to verify clean typecheck
- If typecheck fails, report errors and stop — do NOT deploy broken code

### 3. Commit (if uncommitted changes exist)

- `git status` to check for uncommitted changes
- `git diff --stat` to review what changed
- `git log --oneline -3` to match commit message style
- Stage relevant files (exclude secrets, temp files, config exports)
- Commit with a descriptive message following the project's `feat:/fix:/docs:` convention
- Include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`

### 4. Push

- `git push` to origin/main

### 5. Deploy to Railway

- `railway up --detach` from the project root
- Report the build logs URL to the user

### 6. Post-deploy: Prune memory

After successful deploy, review and update the auto-memory file at:
`/Users/clavion/.claude/projects/-Users-clavion-Documents-Business-Clavion-Labs-mentra-anyai-Any-AI/memory/MEMORY.md`

- Check for stale or outdated information (wrong status, old tech stack references, missing features)
- Update any sections that no longer reflect the current state of the project
- Add any new conventions or patterns that were established during this session
- Keep it concise — MEMORY.md has a 200-line display limit

## Important Rules

- Always typecheck before deploying
- Never deploy code that fails typecheck
- Never commit `.env`, `.env.local`, credentials, or vault secrets
- Skip files like `*_config-export*.json`, `.refs/`, `.plans/` unless explicitly requested
- If there are no changes to commit, skip straight to deploy
- Always show the Railway build logs URL at the end
