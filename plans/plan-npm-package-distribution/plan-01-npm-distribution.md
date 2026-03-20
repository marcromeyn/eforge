---
id: plan-01-npm-distribution
name: npm Package Distribution
dependsOn: []
branch: plan-npm-package-distribution/npm-distribution
---

# npm Package Distribution

## Architecture Context

eforge currently builds only a CLI binary via tsup. The engine barrel (`src/engine/index.ts`) already exports the full library API surface, but nothing in the build or package.json exposes it for external consumers. `dist/` is gitignored and no `files` field overrides that for `npm pack`.

## Implementation

### Overview

Add a library entry point to the tsup build, generate `.d.ts` files via a separate `tsc` pass, and configure package.json so the package works as both a global CLI (`npx eforge`) and an importable library (`import { EforgeEngine } from 'eforge'`). Also add a `pnpm build` step to CI so build regressions are caught.

### Key Decisions

1. **`tsc --emitDeclarationOnly` over tsup's `dts` option** - tsup's built-in dts is unreliable with complex barrel re-exports. A separate `tsc -p tsconfig.build.json` pass is more predictable. Declarations land in `dist/types/`.
2. **All dependencies externalized in the library entry** - unlike the CLI entry (which only externalizes the SDK), the library entry externalizes everything in `dependencies` since library consumers manage their own `node_modules`.
3. **`splitting: true` for library entry** - preserves the module graph so consumers get tree-shaking. The CLI entry stays `splitting: false` (single file binary).
4. **`files` allowlist instead of `.npmignore`** - `files: ["dist/", "LICENSE", "README.md"]` is explicit and avoids confusing interactions between `.gitignore` and `.npmignore`.
5. **`onSuccess` moved to last config entry** - the `restoreNodePrefixes()` and prompt copy must run after all tsup builds complete. Moving them to the last array entry ensures this.

## Scope

### In Scope
- `tsconfig.build.json` for declaration-only emit
- Library entry in tsup config (`src/engine/index.ts` -> `dist/index.js`)
- package.json: `exports`, `types`, `files`, `engines`, `publishConfig`, `repository`, `homepage`
- Build script update to chain `tsc -p tsconfig.build.json` after tsup
- `prepublishOnly` script as a publish safety net
- CI `pnpm build` step before type-check and test

### Out of Scope
- `.npmignore` file
- `declarationMap` / shipping `src/` in the tarball
- CJS output
- Backwards compatibility shims
- npm publish automation (that's a separate concern)

## Files

### Create
- `tsconfig.build.json` - Declaration-only emit config extending `tsconfig.json`. Sets `emitDeclarationOnly: true`, `declaration: true`, `declarationDir: "dist/types"`, overrides `noEmit: false`. Excludes `test/` and `src/monitor/ui/`.

### Modify
- `tsup.config.ts` - Add a third config entry for the library build: entry `src/engine/index.ts`, `splitting: true`, all `dependencies` externalized, no shebang. Move `onSuccess` (prompt copy + `restoreNodePrefixes()`) from the CLI entry to the last config entry (monitor-server) so it runs after all builds complete. Set `clean: false` on the library entry since the CLI entry already cleans.
- `package.json` - Add `exports` (`".": { "types": "./dist/types/engine/index.d.ts", "import": "./dist/index.js" }`), `types` (`"./dist/types/engine/index.d.ts"`), `files` (`["dist/", "LICENSE", "README.md"]`), `engines` (`{ "node": ">=22" }`), `publishConfig` (`{ "access": "public" }`), `repository` (`{ "type": "git", "url": "git+https://github.com/eforge-run/eforge.git" }`), `homepage` (`"https://eforge.run"`). Update `build` script to append `&& tsc -p tsconfig.build.json`. Add `prepublishOnly` script: `"pnpm build && pnpm test"`.
- `.github/workflows/ci.yml` - Add `- run: pnpm build` step after `pnpm install` and before `pnpm type-check`.

## Verification

- [ ] `pnpm build` exits 0 and produces `dist/cli.js`, `dist/index.js`, `dist/server-main.js`, `dist/prompts/`, and `dist/types/engine/index.d.ts`
- [ ] `dist/cli.js` starts with `#!/usr/bin/env` shebang line
- [ ] `dist/index.js` does NOT contain a shebang line
- [ ] `npm pack --dry-run` output includes `dist/`, `LICENSE`, `README.md`, and `package.json` - does NOT include `src/`, `test/`, `node_modules/`, or `tsup.config.ts`
- [ ] `npm pack` creates a tarball; installing it in a temp project allows `import { EforgeEngine } from 'eforge'` to resolve without errors
- [ ] `npx eforge --help` works from the installed tarball
- [ ] `dist/types/engine/index.d.ts` exists and exports `EforgeEngine`
- [ ] `pnpm test` passes
- [ ] `pnpm type-check` passes
