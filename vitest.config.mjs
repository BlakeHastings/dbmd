// Keep the test run inside this working tree.
//
// Agent worktrees are created at `.claude/worktrees/<name>/`, which is inside
// the repository. `.gitignore` holds them out of `git status`, and vitest does
// not read `.gitignore`, so every one of them is a second complete copy of the
// suite as far as the default globs are concerned.
//
// Measured: with nine merged agent worktrees still on disk, `npm run check` in
// this checkout reported 3927 tests instead of 457, and every one of the extras
// belonged to a branch that had already landed. A stale worktree can therefore
// turn a local run red for something you did not write, or green because a
// branch you are not on happens to pass. `AGENTS.md` promises that a green
// local run and a green CI run mean the same thing, and CI clones the
// repository so it never sees these at all.
//
// Excluding the whole of `.claude/` rather than just `worktrees/` is
// deliberate: nothing under it is ever this project's source.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
})
