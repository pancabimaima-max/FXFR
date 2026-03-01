# Project Guidelines (GEMINI.md)

## 1. Workflow Shorthands
- **`//plan`**: When this symbol is used in a prompt, the agent must:
  1. Research the codebase/requirements.
  2. Propose a technical strategy.
  3. Use the `ask_user` tool with `type: 'choice'` to present implementation options.
  4. Wait for user confirmation or addendum before executing any tool that modifies the filesystem.
- **`//revert`**: When this symbol is used, the agent must:
  1. Perform a `git reset --hard HEAD~1` to undo the last commit.
  2. If there are unstaged changes currently breaking the build, run `git reset --hard HEAD` and `git clean -fd` first.
  3. Confirm to the user that the workspace has been restored.

## 2. Git Automation Policy
- **Pre-Execution Checkpoint**: Before starting a new directive, if the working directory is "dirty" (has uncommitted changes), the agent must commit them with the message: `chore: pre-task checkpoint for [Task Name]`.
- **Post-Execution Commit**: After completing a directive and verifying success, the agent must ALWAYS commit the changes.
  - **Commit Message Style**: Must follow Conventional Commits (e.g., `feat:`, `fix:`, `refactor:`) and include a 1-2 sentence description of the specific changes made.

## 3. General Preferences
- Always prioritize `ask_user` for architectural decisions.
- Maintain a high-signal, professional tone.
- Follow the Research -> Strategy -> Execution lifecycle for all Directives.
