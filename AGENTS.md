# Repository Guidelines

## Project Structure & Module Organization
- `src/`: TypeScript sources and colocated tests (`*.test.ts`).
- `dist/`: Compiled JS and types (`tsc` output). Do not edit.
- `static/`: Static assets (icons, images).
- `README.md`: CLI usage and examples.
- `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc`: Tooling config.
- Config file example: `.crawlsnaprc.example.json` (users may copy to `.crawlsnaprc.json`).

## Build, Test, and Development Commands
- `npm run dev` or `pnpm dev`: Run in watch mode with tsx. Pass CLI args after `--`.
  Example: `pnpm dev -- https://example.com --desktop`.
- `npm run build` or `pnpm build`: Type-check and compile to `dist/`.
- `npm start` or `pnpm start`: Run compiled CLI (`node dist/index.js`).
- `npm test` / `pnpm test`: Run unit tests (Vitest).
- `pnpm test:watch`: Watch mode for tests.
- `npm run lint` / `pnpm lint`: ESLint checks. `lint:fix` to autofix.
- `npm run format`: Prettier formatting (Markdown is ignored by default).
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
- Commits: short, imperative subject; reference PRs/issues when relevant (e.g., "Fix badges (#3)").
- Scope small; keep changes focused. Update `README.md` and `.crawlsnaprc.example.json` when flags/options change.
- PRs: include description, rationale, before/after if behavior changes, test coverage, and `pnpm lint` clean output. Screenshots not required; CLI logs/examples are helpful.

## Security & Configuration Tips
- Avoid committing real `.crawlsnaprc.json` with sensitive URLs; use the example file.
- Output defaults to `generated-screenshots/` under the chosen `--output` dir; do not commit artifacts.
- When adding options, validate inputs and respect existing defaults to prevent breaking changes.
