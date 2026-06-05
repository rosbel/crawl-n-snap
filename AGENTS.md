# Repository Guidelines

## Project Structure & Module Organization

- `src/`: TypeScript sources and colocated tests (`*.test.ts`).
- `dist/`: Compiled JS and types (`tsc` output). Do not edit.
- `static/`: Static assets (icons, images).
- `README.md`: CLI usage and examples.
- `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc`: Tooling config.
- Config file example: `.crawlsnaprc.example.json` (users may copy to `.crawlsnaprc.json`).

## Build, Test, and Development Commands

- `npm run dev` or `pnpm dev`: Launches the web UI (React + Vite) and dev API server. Enter a URL, tweak options, run/abort, view logs.
  - `pnpm dev:cli -- <args>`: Watch the CLI entry with your own args.
    Example: `pnpm dev:cli -- https://example.com --desktop`.
- `npm run build` or `pnpm build`: Type-check and compile to `dist/`.
- `npm start` or `pnpm start`: Run compiled CLI (`node dist/index.js`).
- `npm test` / `pnpm test`: Run unit tests (Vitest).
- `pnpm test:watch`: Watch mode for tests.
- `npm run lint` / `pnpm lint`: ESLint checks. `lint:fix` to autofix.
- `npm run format`: Prettier formatting (includes Markdown).
- First-time Playwright setup: `npx playwright install` (or `pnpx playwright install`).

## Coding Style & Naming Conventions

- Language: TypeScript (Node >= 20).
- Indentation: 2 spaces; single quotes; semicolons; width 100 (Prettier enforced).
- File names: kebab-case for files, `*.test.ts` for tests colocated with sources.
- Linting: ESLint with `@typescript-eslint` (see `eslint.config.mjs`). Fix warnings before PRs.

## Testing Guidelines

- Framework: Vitest with V8 coverage (`text`, `lcov`, `html`).
- Location: tests live next to code in `src/` and end with `.test.ts`.
- Run: `pnpm test` (or `npm test`). Coverage reports emit to `coverage/`.

## Commit & Pull Request Guidelines

- Use Conventional Commits: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `perf`, `ci`, `build`, `style`.
  Example: `feat(cli): add --fail-fast flag` or `fix: ensure retry backoff doubles`.
- Keep commits small and focused; reference issues/PRs when relevant (e.g., `(#7)`).
- PRs: include purpose, behavior changes (with before/after if applicable), tests, and lint-clean output. Update `README.md` and the example config when flags/options change.

## Security & Configuration Tips

- Avoid committing real `.crawlsnaprc.json` with sensitive URLs; use the example file.
- Output defaults to `generated-screenshots/` under the chosen `--output` dir; do not commit artifacts.
- When adding options, validate inputs and respect existing defaults to prevent breaking changes.
