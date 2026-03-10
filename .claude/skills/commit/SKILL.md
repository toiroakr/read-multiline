---
name: commit
description: コードの変更をコミット・プッシュする。ユーザーが「commit」「push」「コミット」「プッシュ」を依頼した場合は必ずこのスキルを使用すること。
allowed-tools: Bash, Read, Grep, Write, Edit
---

# Commit and Push Skill

This skill handles committing and pushing code changes with CI-equivalent local checks, changeset validation, and PR description updates.

## Workflow

Before committing and pushing, you MUST complete the following steps in order:

### Step 1: Assess current state

```bash
git status
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "no upstream"
```

If there are no staged or unstaged changes and nothing to commit, inform the user and STOP.

Stage the changes the user wants to commit. If the user hasn't specified which files, ask them or stage all relevant changes.

### Step 2: Run CI-equivalent checks locally

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

- If `build` fails: Report the error and STOP. Do not commit.
- If `lint` or `format:check` fails: Try auto-fix with `pnpm run lint:fix && pnpm run format`. Re-stage any auto-fixed files. If still failing, report the error and STOP.
- If `typecheck` or `knip` fails: Report the error and STOP. Do not commit.
- If `test` fails: Report the error and STOP. Do not commit.

### Step 3: Create the commit

After all checks pass, create the commit using conventional commits format:

- `feat:` - New feature
- `fix:` - Bug fix
- `chore:` - Maintenance
- `refactor:` - Code refactoring
- `docs:` - Documentation

Include any auto-fixed files in the commit.

**Commit message footer rules:**

- Do NOT add any `Co-Authored-By:` lines
- Do NOT add any `Generated with` or `via [Happy]` lines
- Do NOT add any tool/service attribution footer
- The commit message must contain ONLY the type prefix, subject, and optional body

### Step 4: Validate changeset (if exists)

Check if a changeset file exists in the branch diff from main:

```bash
git diff main...HEAD --name-only | grep -E '^\.changeset/.*\.md$' | grep -v README.md
```

**If a changeset exists:**

1. Read the existing changeset file
2. Analyze ALL changes from main:
   ```bash
   git diff main...HEAD
   git log main..HEAD --oneline
   ```
3. If the changeset description is outdated or incomplete, update it to reflect ALL current changes. Keep the version bump type accurate (pre-1.0 policy):
   - `minor`: Breaking changes only
   - `patch`: Bug fixes, new features, refactoring, docs
   - `major`: Not used until 1.0 release
4. Commit the update:
   ```bash
   git add .changeset/*.md
   git commit -m "chore: update changeset description"
   ```

**If NO changeset exists:** Do NOT create one. That is the responsibility of the create-pr skill.

### Step 5: Push to remote (if applicable)

Determine whether to push:

- User explicitly requested push → push
- A PR exists for the current branch → push
- User only said "commit" and no PR exists → do NOT push

```bash
# Check if PR exists
gh pr view --json number,title,body,url 2>/dev/null
```

Push command:

```bash
# If upstream exists
git push

# If no upstream
git push -u origin $(git branch --show-current)
```

### Step 6: Update PR description (if PR exists)

If a PR exists for the current branch, verify the PR title and body accurately reflect ALL current changes:

1. Get current PR info:

   ```bash
   gh pr view --json number,title,body
   ```

2. Analyze ALL changes from main:

   ```bash
   git diff main...HEAD
   git log main..HEAD --oneline
   ```

3. If the PR title or body is outdated or incomplete, update it:

   ```bash
   gh pr edit <number> --title "updated title" --body "$(cat <<'EOF'
   ## Summary

   - Updated description reflecting ALL changes
   EOF
   )"
   ```

4. Follow the same PR format rules as create-pr:
   - **Language**: English
   - **No Test Plan** section
   - **No Claude Footer**
   - **Concise Summary**: Focus on what changed and why

## Commit-Only vs Push

| User request          | Steps executed                                          |
| --------------------- | ------------------------------------------------------- |
| "commit" / "コミット" | Steps 1-4. Also Steps 5-6 if a PR exists for the branch |
| "push" / "プッシュ"   | Steps 1-6                                               |
| "commit and push"     | Steps 1-6                                               |

## Important Notes

- This skill does NOT create PRs. Use the create-pr skill for that.
- This skill does NOT create new changeset files. It only validates and updates existing ones.
- When auto-fix changes files, re-stage them before committing.

## Example

When user says: "コミットしてプッシュして"

1. Check git status, stage changes
2. Run CI checks (build, lint, format:check, typecheck, knip, test) → auto-fix if lint/format fails
3. Commit with conventional commit message
4. Validate existing changeset description against ALL branch changes, update if stale
5. Push to remote
6. Update PR description if PR exists
