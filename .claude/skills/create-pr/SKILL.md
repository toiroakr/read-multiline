---
name: create-pr
description: PRを作成する。ユーザーが「PR」「プルリクエスト」「pull request」の作成を依頼した場合は必ずこのスキルを使用すること。ghコマンドを直接使わず、このスキルを経由すること。
allowed-tools: Bash, Read, Grep, Write
---

# Create Pull Request Skill

This skill creates pull requests with a standardized format after running CI-equivalent checks.

## Pre-PR Workflow

Before creating a PR, you MUST complete the following steps in order:

### Step 1: Run CI-equivalent tests locally

Run these commands in sequence. If any fail, handle as described:

```bash
# 1. Build
pnpm run build

# 2. Lint
pnpm run lint

# 3. Format check
pnpm run format:check

# 4. Typecheck
pnpm run typecheck

# 5. Unused code check
pnpm run knip

# 6. Test
pnpm test
```

**Failure handling:**

- If `build` fails: Report the error and STOP. Do not create PR.
- If `lint` or `format:check` fails: Try auto-fix with `pnpm run lint:fix && pnpm run format`. If still failing, report the error and STOP.
- If `typecheck` or `knip` fails: Report the error and STOP. Do not create PR.
- If `test` fails: Report the error and STOP. Do not create PR.

### Step 2: Check and create changeset if needed

Check if a changeset file exists in the PR diff:

```bash
git diff main...HEAD --name-only | grep -E '^\.changeset/.*\.md$' | grep -v README.md
```

If NO changeset exists, create one:

1. **Analyze ALL changes from main branch** (not just the latest commit):

   ```bash
   git diff main...HEAD
   git log main..HEAD --oneline
   ```

2. **Determine version type automatically (pre-1.0 policy):**
   - `minor`: Breaking changes only
   - `patch`: Bug fixes, new features, refactoring, docs
   - `major`: Not used until 1.0 release

3. **Create changeset file** in `.changeset/` with a random name (e.g., `cool-dogs-fly.md`):

   ```markdown
   ---
   "@toiroakr/read-multiline": patch
   ---

   Description of ALL PR changes in English
   ```

4. **Commit the changeset:**
   ```bash
   git add .changeset/*.md
   git commit -m "chore: add changeset"
   ```

### Step 3: Create PR

After all checks pass and changeset exists, create the PR.

## PR Format Rules

When creating a pull request, follow these rules:

1. **Language**: Write all PR content (title, body) in **English**
2. **No Test Plan**: Do NOT include a "Test plan" section
3. **No Claude Footer**: Do NOT include "🤖 Generated with [Claude Code](https://claude.com/claude-code)" or similar footer
4. **Concise Summary**: Focus on what changed and why

## PR Body Structure

```markdown
## Summary

- Brief description of changes (bullet points)
- Focus on what and why, not how

## Additional sections (optional)

Add relevant sections based on the changes:

- Breaking Changes
- Migration Guide
- Notes
```

## Commands

### Check current state

```bash
git status
git diff main...HEAD
git log main..HEAD --oneline
```

### Create PR

```bash
gh pr create --draft --title "type: description" --body "$(cat <<'EOF'
## Summary

- Change 1
- Change 2
EOF
)"
```

### Update existing PR

```bash
gh pr edit <number> --title "new title" --body "new body"
```

## Commit Message Convention

Use conventional commits format:

- `feat:` - New feature
- `fix:` - Bug fix
- `chore:` - Maintenance
- `refactor:` - Code refactoring
- `docs:` - Documentation

## Complete Workflow Summary

1. Run `pnpm run build` → If fails, STOP and report
2. Run `pnpm run lint` → If fails, try `pnpm run lint:fix` → If still fails, STOP and report
3. Run `pnpm run format:check` → If fails, try `pnpm run format` → If still fails, STOP and report
4. Run `pnpm run typecheck` → If fails, STOP and report
5. Run `pnpm run knip` → If fails, STOP and report
6. Run `pnpm test` → If fails, STOP and report
7. Check if changeset exists in diff → If missing, analyze ALL PR changes and create one
8. Create PR with `gh pr create --draft`

## Example

When user says: "PRを作成して"

1. Run CI checks (build, lint, format:check, typecheck, knip, test)
2. If lint/format fails, run auto-fix and retry
3. Check for changeset, create if missing based on ALL changes from main
4. Create PR with English content:

```bash
gh pr create --draft --title "feat: add dynamic shell completion support" --body "$(cat <<'EOF'
## Summary

- Add dynamic completion provider for runtime argument suggestions
- Support bash, zsh, and fish shell completion scripts
- Add completion extractor for subcommand trees
EOF
)"
```
