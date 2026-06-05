# Crawl-n-Snap

<div align="center">
  <img src="https://github.com/user-attachments/assets/fe25d60a-1b66-4b35-a5c7-f39503158392" width="300"  
    alt="Crawley the octopus, snapshotting while crawling through your website with Playwright" 
    style="box-shadow: 0 4px 12px rgba(0,0,0,0.2); border-radius: 12px;" 
   />
</div>

A CLI tool for taking website screenshots at various resolutions using Playwright, with optional website crawling functionality.

[![npm version][npm-v-src]][npm-v-href]
[![npm downloads][npm-dt-src]][npm-dt-href]
[![package phobia][packagephobia-src]][packagephobia-href]
[![ci status][ci-status-src]][ci-status-href]
[![publish status][publish-status-src]][publish-status-href]
[![license][license-src]][license-href]

## Features

- Take full page screenshots at specified resolutions with **parallel processing**
- Capture multiple resolutions in a single run with configurable concurrency
- Built-in presets for desktop and mobile devices
- Optional website crawling to automatically capture linked pages
- Configurable crawl depth and maximum page limits with URL exclusion patterns
- **Automatic retry logic** for failed screenshots with exponential backoff
- **Configuration file support** (.crawlsnaprc.json) for project-specific settings
- **Advanced error recovery** with detailed error classification and reporting
- Support for Chromium, Firefox, and WebKit browsers
- Organized output directory structure with automatic run numbering

## Installation

```bash
# Install globally
npm install -g @rosbel/crawl-n-snap

# Or using pnpm
pnpm add -g @rosbel/crawl-n-snap
```

Browser binaries need to be installed (if not already present):

```bash
# Using npm
npx playwright install

# Using pnpm
pnpx playwright install
```

## Usage

You can use it directly if installed globally:

```bash
crawl-n-snap https://example.com [options]
```

Or run it without installing:

```bash
# Using npm
npx @rosbel/crawl-n-snap https://example.com [options]

# Using pnpm
pnpx @rosbel/crawl-n-snap https://example.com [options]
```

### Options

```
Arguments:
  url                      The full URL (including http/https) of the page to screenshot.

Options:
  -r, --resolution <WxH>   Custom screen resolution (e.g., 1920x1080). Repeatable. Replaces the default.
  -d, --desktop            Add the desktop preset resolution (1920x1080)
  -m, --mobile             Add the mobile preset resolution (390x844)
  -o, --output <dir>       Base output directory for screenshots (default: current directory)
  -b, --browser <name>     Browser to use (chromium, firefox, webkit) (default: "chromium")
  -c, --crawl              Enable crawling of all relative links on the website
  -p, --max-pages <n>      Maximum number of pages to crawl (only used with --crawl) (default: 50)
  -t, --timeout <ms>       Early screenshot timeout: take the shot once this elapses even if still loading (default: 5000)
  --nav-timeout <ms>       Hard navigation timeout: max time to wait for a page load before giving up (default: 30000)
  --concurrency <n>        Maximum number of concurrent screenshot operations (default: 3)
  -R, --retries <n>        Number of retry attempts for failed screenshots (default: 2)
  -x, --exclude-pattern    URL patterns to exclude from crawling (supports wildcards like */admin/*). Repeatable.
  -i, --include-pattern    URL patterns to include when crawling (supports wildcards). Repeatable.
  --wait-until <state>     Navigation waitUntil (load | domcontentloaded | networkidle | commit) (default: load)
  --delay <ms>             Delay before screenshot after navigation/timeout (ms) (default: 0)
  --no-full-page           Capture only the visible viewport (default is full page)
  --no-headless            Run the browser in headed mode (show the UI)
  --format <type>          Image format: png or jpeg (default: png)
  --quality <1-100>        JPEG quality 1-100 (only used with --format jpeg)
  --selector <css>         Capture only the element matching this CSS selector (must match exactly one)
  --clip <x,y,w,h>         Capture only a fixed region of the page (e.g. 0,0,800,600)
  --wait-for-selector <css>  Wait for this CSS selector before capturing
  --disable-animations     Freeze CSS animations/transitions for stable screenshots
  --scale <n>              Device scale factor / DPR (e.g. 2 for retina). Default: 1
  --color-scheme <scheme>  Emulate prefers-color-scheme (light | dark | no-preference)
  --user-agent <string>    Override the browser User-Agent string
  --device <name>          Emulate a Playwright device (e.g. "iPhone 13"); overrides -r
  --header <name:value>    Extra HTTP header to send. Repeatable.
  --basic-auth <user:pass> HTTP Basic auth credentials for gated pages
  --storage-state <file>   Load cookies/localStorage from a Playwright storageState file
  --depth <n>              Maximum crawl depth in link hops from the seed (with --crawl). Default: unlimited
  --dry-run                Print the resolved run plan and exit without launching a browser
  --json                   Output the run manifest as JSON on stdout (human logs go to stderr)
  --no-color               Disable colored/unicode status markers (plain ASCII)
  --continue-on-error      Continue processing other URLs/resolutions when errors occur (default: true)
  --fail-fast              Stop processing immediately when any error occurs
  -V, --version            Output the version number
  -h, --help               Display help for command
```

> Resolutions: if you pass one or more `-r` values they are used as-is (the
> default 1920x1080 is **not** added). `--desktop`/`--mobile` add their preset
> on top of whatever you provide. With no `-r` and no preset, 1920x1080 is used.

### Examples

#### Take a screenshot at the default resolution (1920x1080)

```bash
# npm
npx @rosbel/crawl-n-snap https://example.com

# pnpm
pnpx @rosbel/crawl-n-snap https://example.com
```

#### Take screenshots at multiple custom resolutions

```bash
npx @rosbel/crawl-n-snap https://example.com -r 1920x1080 -r 1366x768 -r 375x667
```

#### Use preset device resolutions

```bash
npx @rosbel/crawl-n-snap https://example.com --desktop --mobile
```

#### Crawl a website and take screenshots of all linked pages

```bash
npx @rosbel/crawl-n-snap https://example.com --crawl --max-pages 10
```

#### Use a different browser (Firefox) and custom output directory

```bash
npx @rosbel/crawl-n-snap https://example.com --browser firefox --output ./screenshots
```

#### Set a custom early screenshot timeout (5 seconds)

```bash
npx @rosbel/crawl-n-snap https://example.com --timeout 5000
```

Note: `--timeout` is the _early screenshot_ cutoff — the tool takes the shot once it elapses even if the page is still loading. `--nav-timeout` (default 30000) is the _hard_ cap on how long Playwright waits for a page load before giving up.

#### Use configuration file for project settings

```bash
npx @rosbel/crawl-n-snap https://example.com
```

If a `.crawlsnaprc.json` file exists in the current directory or home directory:

```json
{
  "resolutions": ["1920x1080", "1366x768", "390x844"],
  "browser": "firefox",
  "output": "./screenshots",
  "crawl": true,
  "maxPages": 20,
  "timeout": 7000,
  "navTimeout": 30000,
  "concurrency": 2,
  "retries": 3,
  "continueOnError": true,
  "waitUntil": "load",
  "delay": 0,
  "fullPage": true,
  "headless": true,
  "includePatterns": ["*/products/*"],
  "excludePatterns": ["*/admin/*", "*/login/*"]
}
```

#### Exclude URLs from crawling

```bash
npx @rosbel/crawl-n-snap https://example.com --crawl \
  --exclude-pattern "*/admin/*" \
  --exclude-pattern "*/login/*" \
  --exclude-pattern "*checkout*"
```

#### Control concurrency and retries

```bash
npx @rosbel/crawl-n-snap https://example.com \
  --concurrency 5 \
  --retries 3 \
  --continue-on-error
```

#### Stop on first error (fail fast)

```bash
npx @rosbel/crawl-n-snap https://example.com --fail-fast
```

#### Capture options (format, element, region, stability)

```bash
# Smaller files: JPEG at quality 80
npx @rosbel/crawl-n-snap https://example.com --format jpeg --quality 80

# Capture just one component (must match exactly one element)
npx @rosbel/crawl-n-snap https://example.com --selector "#hero"

# Capture a fixed region (x, y, width, height)
npx @rosbel/crawl-n-snap https://example.com --clip 0,0,1200,630

# Wait for content and freeze animations for a deterministic shot
npx @rosbel/crawl-n-snap https://example.com \
  --wait-for-selector ".loaded" \
  --disable-animations
```

Notes:

- `--selector` and `--clip` are mutually exclusive, and both take precedence over `--full-page`.
- `--quality` only applies to `--format jpeg`.

#### Device emulation, dark mode, and authentication

```bash
# Retina (2x) screenshots
npx @rosbel/crawl-n-snap https://example.com --scale 2

# Dark mode
npx @rosbel/crawl-n-snap https://example.com --color-scheme dark

# Emulate a real device (sets viewport, DPR, touch, and UA; -r is ignored)
npx @rosbel/crawl-n-snap https://example.com --device "iPhone 13"

# Screenshot pages behind HTTP Basic auth, a bearer token, or a saved session
npx @rosbel/crawl-n-snap https://example.com --basic-auth "user:pass"
npx @rosbel/crawl-n-snap https://example.com --header "Authorization: Bearer <token>"
npx @rosbel/crawl-n-snap https://example.com --storage-state ./auth.json
```

Secrets (`--basic-auth`, `--header`, `--storage-state`) are never printed to the console or written to `run.json` (only a boolean/count is recorded).

#### Crawl depth and scripting-friendly output

```bash
# Crawl only the seed page and pages it links to directly (1 hop)
npx @rosbel/crawl-n-snap https://example.com --crawl --depth 1

# Preview what a run would do without launching a browser
npx @rosbel/crawl-n-snap https://example.com --crawl --max-pages 50 --dry-run

# Machine-readable output: the manifest is the only thing on stdout
npx @rosbel/crawl-n-snap https://example.com --json | jq '.summary'

# Plain ASCII markers (e.g. when piping to a file or CI log)
npx @rosbel/crawl-n-snap https://example.com --no-color
```

## Output Structure

Screenshots are saved with the following structure:

```
<output_dir>/generated-screenshots/<hostname>/<date>/<run_number>/<resolution>-<path>.png
```

For example:

```
./generated-screenshots/example.com/20240328/1/1920x1080-root.png
./generated-screenshots/example.com/20240328/1/1920x1080-about.png
```

## Configuration File

Crawl-n-Snap supports configuration files to store project-specific settings. The tool looks for configuration files in this order:

1. `.crawlsnaprc.json` in the current directory
2. `.crawlsnaprc` in the current directory
3. `.crawlsnaprc.json` in the home directory
4. `.crawlsnaprc` in the home directory

### Configuration Options

All CLI options can be specified in the configuration file. CLI options take precedence over configuration file settings.

```json
{
  "resolutions": ["1920x1080", "1366x768", "390x844"],
  "browser": "chromium",
  "output": "./screenshots",
  "crawl": false,
  "maxPages": 50,
  "timeout": 5000,
  "navTimeout": 30000,
  "concurrency": 3,
  "retries": 2,
  "continueOnError": true,
  "waitUntil": "load",
  "delay": 0,
  "fullPage": true,
  "headless": true,
  "desktop": false,
  "mobile": false,
  "includePatterns": [],
  "excludePatterns": ["*/admin/*", "*/login/*", "*checkout*"]
}
```

### Exclude Patterns

Exclude patterns support glob-like wildcards:

- `*/admin/*` - Excludes any URL containing `/admin/` in the path
- `*login*` - Excludes any URL containing "login" anywhere
- `https://*/internal/*` - Excludes internal paths on any domain
- `*/api/*` - Excludes API endpoints

Patterns are case-insensitive and support standard glob wildcards (`*`).

## Performance & Reliability

### Parallel Processing

By default, screenshots are taken in parallel (up to 3 concurrent operations) for better performance. You can adjust this with the `--concurrency` option:

```bash
# Process up to 5 screenshots simultaneously
npx @rosbel/crawl-n-snap https://example.com --concurrency 5

# Process screenshots one at a time (safest for low-memory systems)
npx @rosbel/crawl-n-snap https://example.com --concurrency 1
```

### Retry Logic

Failed screenshots are automatically retried with exponential backoff:

- 1st retry: after 1 second
- 2nd retry: after 2 seconds
- 3rd retry: after 4 seconds
- etc.

```bash
# Set custom retry attempts
npx @rosbel/crawl-n-snap https://example.com --retries 5

# Disable retries
npx @rosbel/crawl-n-snap https://example.com --retries 0
```

### Error Handling

The tool provides detailed error classification and reporting:

- **Navigation errors**: Timeouts, network issues, DNS resolution
- **Screenshot errors**: Page rendering issues, memory problems
- **File system errors**: Disk space, permissions, path issues
- **Link extraction errors**: DOM parsing, JavaScript execution

By default, the tool continues processing other URLs when errors occur. Use `--fail-fast` to stop on the first error.

## Development

### Testing

This project uses Vitest for unit testing. Run the tests with:

```bash
# Run tests once
pnpm test

# Run tests in watch mode
pnpm test:watch
```

### Linting

ESLint is configured for code quality. Run the linter with:

```bash
# Check for issues
pnpm lint

# Fix automatically fixable issues
pnpm lint:fix
```

### Local Dev UI

Run the web UI (React + Vite) that mirrors CLI options and streams logs:

```bash
pnpm dev
```

This starts:

- Dev API: `http://localhost:3001` (proxies from Vite), spawns the CLI with your options
- Web UI: `http://localhost:5173` (auto-opens in the terminal)

You can enter a URL, adjust options, run/abort, and watch logs live. For direct CLI watching with your own args:

```bash
pnpm dev:cli -- https://example.com --desktop
```

## CI/CD

This project uses GitHub Actions for continuous integration and deployment:

### Continuous Integration

The CI workflow runs on pull requests to the main branch and includes:

- Automated testing
- Code linting
- Build verification

### Releasing (Changesets)

Versioning and npm publishing are managed with [Changesets](https://github.com/changesets/changesets), so the version is bumped intentionally rather than on every push.

**For contributors** — include a changeset with any user-facing change:

```bash
pnpm changeset
```

Pick the bump type (patch / minor / major) and write a short summary. Commit the generated file in `.changeset/` with your PR.

**Release flow** — on every push to `main`, the publish workflow either:

1. **Opens/updates a "Version Packages" PR** (when changesets are pending) that bumps `package.json` and updates `CHANGELOG.md`; or
2. **Publishes to npm** (when that PR is merged and the version has changed) via `changeset publish`, which skips any version already on the registry.

This is why pushing to `main` no longer fails trying to republish an existing version.

**One-time setup:** add a repository secret named `NPM_TOKEN` containing a valid npm **Automation** access token (or a Granular token with read+write to `@rosbel/crawl-n-snap`). An expired/insufficient token surfaces as an `E404` on publish.

## Contributors

- [Rosbel](https://github.com/rosbel) - Project creator
- [Claude AI](https://claude.ai/code) - Development support & documentation

## License

MIT

<!-- Refs -->

[npm-v-src]: https://flat.badgen.net/npm/v/@rosbel/crawl-n-snap/latest
[npm-v-href]: https://npmjs.com/package/@rosbel/crawl-n-snap
[npm-dt-src]: https://flat.badgen.net/npm/dt/@rosbel/crawl-n-snap
[npm-dt-href]: https://npmjs.com/package/@rosbel/crawl-n-snap
[packagephobia-src]: https://flat.badgen.net/packagephobia/install/@rosbel/crawl-n-snap
[packagephobia-href]: https://packagephobia.now.sh/result?p=@rosbel/crawl-n-snap
[ci-status-src]: https://img.shields.io/github/actions/workflow/status/rosbel/crawl-n-snap/.github%2Fworkflows%2Fci.yml?label=tests
[ci-status-href]: https://github.com/rosbel/crawl-n-snap/actions/workflows/ci.yml
[publish-status-src]: https://img.shields.io/github/actions/workflow/status/rosbel/crawl-n-snap/.github%2Fworkflows%2Fnpm-publish.yml?label=publish
[publish-status-href]: https://github.com/rosbel/crawl-n-snap/actions/workflows/npm-publish.yml
[license-src]: https://img.shields.io/github/license/rosbel/crawl-n-snap
[license-href]: https://github.com/rosbel/crawl-n-snap/blob/main/LICENSE
