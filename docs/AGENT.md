# GitHub Issue → PR Automation Agent

This document explains how to use the automated GitHub Issue → PR agent.

## Overview

The agent automatically creates a branch and PR when you create a GitHub issue with the `agent` label. This is useful for:
- Feature requests that need implementation
- Bug fixes that need code changes
- Documentation updates
- Any task that requires a PR

## Setup

### 1. Create GitHub Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a name: `Trading Buddy Agent`
4. Select scopes:
   - ✅ `repo` (full control of private repositories)
   - ✅ `workflow` (update GitHub Action workflows)
5. Click "Generate token"
6. **Copy the token** (you won't see it again!)

### 2. Add Secret to Repository

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `GH_AGENT_TOKEN`
5. Value: Paste your Personal Access Token
6. Click **Add secret**

### 3. Verify Workflow File

The workflow file should exist at `.github/workflows/agent_issue_to_pr.yml`. If it doesn't, create it (see the main README for the content).

## Usage

### Creating an Agent Issue

1. **Create a new issue** in GitHub
2. **Add the label `agent`** (this triggers the workflow)
3. Fill in:
   - **Title**: Clear description of what needs to be done
   - **Body**: Detailed description, requirements, acceptance criteria

Example:
```
Title: Add dark mode to dashboard

Body:
The dashboard should support dark mode.

Requirements:
- Add a theme toggle button
- Persist preference in localStorage
- Support system preference detection
- Update all components to use theme colors

Acceptance criteria:
- [ ] Theme toggle visible in header
- [ ] Dark mode works on all pages
- [ ] Preference persists across page reloads
```

### What Happens Next

1. **GitHub Actions workflow triggers** (within ~1 minute)
2. **Branch created**: `agent/issue-<nr>-<slug>`
   - Example: `agent/issue-42-add-dark-mode`
3. **Artifact file created**: `agent_artifacts/issue-<nr>-plan.md`
   - Contains issue details and plan
4. **ROADMAP.md updated**: Adds a reference to the issue
5. **PR created**: Automatically opens a PR from the branch to `main`

### Working on the PR

1. **Checkout the branch**:
   ```bash
   git fetch origin
   git checkout agent/issue-<nr>-<slug>
   ```

2. **Review the artifact**:
   - Read `agent_artifacts/issue-<nr>-plan.md`
   - Update it with your implementation plan

3. **Make changes**:
   - Implement the feature/fix
   - Update the artifact file as needed
   - Commit your changes

4. **Push and update PR**:
   ```bash
   git push origin agent/issue-<nr>-<slug>
   ```
   - The PR will automatically update

5. **Review and merge**:
   - Review the PR
   - Merge when ready

## Troubleshooting

### Workflow doesn't trigger

- ✅ Check that the issue has the `agent` label
- ✅ Check that `.github/workflows/agent_issue_to_pr.yml` exists
- ✅ Check GitHub Actions tab for errors

### PR creation fails

- ✅ Verify `GH_AGENT_TOKEN` secret is set correctly
- ✅ Check that the token has `repo` and `workflow` permissions
- ✅ Check GitHub Actions logs for error messages

### Branch already exists

- The agent will fail if the branch already exists
- Delete the old branch or use a different issue number

### Agent script errors

- Check the GitHub Actions logs
- Verify environment variables are set correctly
- Ensure `src/agent/runAgent.mjs` exists and is executable

## Manual Execution

You can also run the agent script manually for testing:

```bash
export ISSUE_NUMBER=42
export ISSUE_TITLE="Add dark mode"
export ISSUE_BODY="Add dark mode support to the dashboard"
export BASE_BRANCH=main

node src/agent/runAgent.mjs
```

## Files Created

- `agent_artifacts/issue-<nr>-plan.md` - Artifact file with issue details
- `ROADMAP.md` - Updated with issue reference (in "Agent" section)

## Security

- The `GH_AGENT_TOKEN` should have minimal required permissions
- Never commit the token to the repository
- Use repository secrets, not environment variables in workflows
- Rotate the token periodically

## Limitations

- One PR per issue (if PR already exists, creation will fail)
- Branch names are limited to 50 characters (slugified from title)
- Requires write access to the repository
- Only works on the default branch (`main`)
