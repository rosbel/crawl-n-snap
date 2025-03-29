# Guidelines for Claude Agents

## Commands

- `pnpm run build`: Compile TypeScript to JavaScript
- `pnpm run dev`: Start with live reload (`tsx watch src/index.ts -- [args]`)
- `pnpm run start`: Run compiled JS (`node dist/index.js [args]`)
- `pnpm test`: Run unit tests
- `pnpm test:watch`: Run unit tests in watch mode
- `pnpm lint`: Run ESLint on the codebase
- `pnpm lint:fix`: Fix automatically fixable lint issues
- `pnpm format`: Run Prettier on specified files
- `pnpm lint-staged`: Run linting and formatting on staged files
- `pnpx playwright install`: Install browser binaries if needed

## Pre-commit Hooks

The project uses Husky and lint-staged to automatically:
- Format code with Prettier
- Fix ESLint issues
- These hooks only run on changed files when committing

## Coding Standards

- **Formatting**: TypeScript with 4-space indentation; strict type checking
- **Naming**: camelCase for variables/functions, PascalCase for interfaces/types
- **Types**: Always use explicit types for function parameters and returns
- **Imports**: Group imports by external modules then internal
- **Error Handling**: Use try/catch with typed errors (e.g., `error: any` or `Error`)
- **Comments**: Document functions with brief descriptions; complex logic needs comments
- **Functions**: Prefer small, pure functions with descriptive names
- **Browser Handling**: Always use try/finally to close browser instances
- **File Structure**: Keep CLI logic separate from core functionality

## CLI Tool Structure
This project is a CLI tool for taking website screenshots at various resolutions using Playwright.