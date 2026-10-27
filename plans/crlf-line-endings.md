# CRLF line endings on Windows

## Goal

Checkouts on Windows should be CRLF and stay CRLF: `npm run check` passes on them,
and `check:write` doesn't flip them back to LF. Linux (CI, Docker, servers) keeps LF.

## Environment / context

- Branch `crlf-line-endings` in worktree `C:/Users/camer/git/pfs-crlf`, based on master.
- The main checkout (`~/git/playgrounds/practice-field-scheduler`) shows 46 files as
  modified that are byte-identical to HEAD. They are LF on disk, and the global
  `core.autocrlf=true` expects CRLF.
- The repo uses npm (`package-lock.json`). CI runs `npm ci`, `npm run check`, typecheck and tests on Ubuntu.

## Root cause

Both formatters force LF: Prettier has `endOfLine: "lf"`, and Biome defaults to LF.
So a CRLF checkout fails `npm run check`, and any `--write` run turns files back to LF.
Git then sees those files as modified.

## Decisions already made (don't re-ask)

- Git owns line endings through a repo `.gitattributes` with `* text=auto`. The index is
  already all LF, so nothing gets renormalized.
- Prettier: `endOfLine: "auto"`.
- Biome: upgrade from 2.0.6 (which has no such option) and set `lineEnding: "auto"`.
- Land it on a branch first, so CI proves the change on Linux before master moves.

## Plan / steps

1. Add `.gitattributes`, and switch Prettier to `auto`.
2. Upgrade Biome, set `lineEnding: "auto"`, and fix any new lint findings.
3. Run check, typecheck and unit tests on a CRLF checkout locally.
4. Push the branch, and confirm CI passes on Linux.
5. Merge to master.
6. In the main checkout, rewrite only files whose content matches the index to CRLF, so
   the 46 phantom modifications clear without touching real edits from other threads.

All steps are done.

## Findings / gotchas

- On scratch copies, both checkers rejected a CRLF file until set to `auto`.
- On 2026-10-26, the C: drive filled up (0 GB free) and `npm ci` failed partway. By
  2026-10-27 the drive had about 145 GB free again.
- Biome 2.6 starts formatting Markdown and linting SVG, which 2.0.6 never did. Prettier
  owns Markdown, so both are excluded from Biome in `files.includes` to keep the old coverage.
- Biome 2.6 requires a `level` on any rule configured with `options` (`useExhaustiveDependencies`).
- CI's `publish-test-report` job once failed with `429 Too Many Requests` from
  `public.ecr.aws` while pulling the Allure image. A re-run passed; it's unrelated to this change.
- Rewriting an LF file to CRLF can still leave it "modified" in `git status`, even though
  `git diff` is empty and `git hash-object` matches the index. When the cached size differs,
  git flags the file without hashing it, and `git update-index --refresh` doesn't help.
  Running `git add` on exactly those paths records the new stat and stages nothing
  (`git diff --cached` is empty). The 45 phantom files didn't need this, because their
  cached sizes were already the CRLF sizes.
- A checkout's `node_modules` needs `npm install` after this lands: Biome 2.0.6 can't
  read the migrated `biome.jsonc`.

## Progress log

- [x] Root cause found
- [x] `.gitattributes` and Prettier
- [x] Biome upgrade to 2.6.3, plus fixes for the rules it newly enforces
- [x] Local checks on CRLF: check, typecheck and unit tests pass, and `check:write` changes nothing
- [x] CI green on branch (test, lint, publish-test-report)
- [x] Merged: `fc6667c` fast-forwarded onto master
- [x] Main checkout cleaned: 45 phantom files plus 102 clean-but-LF files are CRLF, status is
      empty, Biome 2.6.3 installed, `npm run check` passes

## Things not to do

- Don't `git checkout --`, `git restore` or `git reset --hard` the main checkout to clear
  the phantom modifications. Other threads may have real edits there.
