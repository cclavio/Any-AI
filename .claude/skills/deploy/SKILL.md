---
name: deploy
description: This skill should be used when the user asks to "deploy", "push and deploy", "ship it", "commit and deploy", "release", or mentions deploying to Railway. Handles the full commit → push → Railway deploy workflow for the Any AI project.
version: 1.0.0
---

# Deploy — Any AI

Commit, push, and deploy the Any AI project to Railway in a single workflow.

## When This Skill Applies

- User says "deploy", "ship it", "push and deploy", "commit and deploy"
- User asks to release or deploy changes to production
- User asks to commit, push, and deploy in one step

## Workflow

### 1. Pre-flight checks

- Run `npx tsc --noEmit` to verify clean typecheck
- If typecheck fails, report errors and stop — do NOT deploy broken code

### 2. Commit (if uncommitted changes exist)

- `git status` to check for uncommitted changes
- `git diff --stat` to review what changed
- `git log --oneline -3` to match commit message style
- Stage relevant files (exclude secrets, temp files, config exports)
- Commit with a descriptive message following the project's `feat:/fix:/docs:` convention
- Include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`

### 3. Push

- `git push` to origin/main

### 4. Deploy to Railway

- `railway up --detach` from the project root
- Report the build logs URL to the user

## Important Rules

- Always typecheck before deploying
- Never deploy code that fails typecheck
- Never commit `.env`, `.env.local`, credentials, or vault secrets
- Skip files like `*_config-export*.json` and `ref-images/` unless explicitly requested
- If there are no changes to commit, skip straight to deploy
- Always show the Railway build logs URL at the end
