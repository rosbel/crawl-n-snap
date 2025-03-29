# Crawl-n-Snap

<div align="center">
  <img src="https://github.com/user-attachments/assets/fe25d60a-1b66-4b35-a5c7-f39503158392" width="300"  
    alt="Crawley the octopus, snapshotting while crawling through your website with Playwright" 
    style="box-shadow: 0 4px 12px rgba(0,0,0,0.2); border-radius: 12px;" 
   />
</div>

A CLI tool for taking website screenshots at various resolutions using Playwright, with optional website crawling functionality.

[![npm version][npm-v-src]][npm-v-href]
[![npm downloads][npm-dm-src]][npm-dm-href]
[![package phobia][packagephobia-src]][packagephobia-href]
[![ci status][ci-status-src]][ci-status-href]
[![publish status][publish-status-src]][publish-status-href]
[![license][license-src]][license-href]

## Features

- Take full page screenshots at specified resolutions
- Capture multiple resolutions in a single run
- Built-in presets for desktop and mobile devices
- Optional website crawling to automatically capture linked pages
- Configurable crawl depth and maximum page limits
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
  url                     The full URL (including http/https) of the page to screenshot.

Options:
  -r, --resolution <WxH>  Custom screen resolution (e.g., 1920x1080). Repeatable.
  -d, --desktop           Capture desktop resolutions (1920x1080)
  -m, --mobile            Capture mobile resolutions (390x844)
  -o, --output <dir>      Base output directory for screenshots (default: current directory)
  -b, --browser <n>       Browser to use (chromium, firefox, webkit) (default: "chromium")
  -c, --crawl             Enable crawling of all relative links on the website
  -p, --max-pages <n>     Maximum number of pages to crawl (only used with --crawl) (default: 50)
  -t, --timeout <ms>      Early screenshot timeout in milliseconds (default: 5000, max Playwright timeout: 30000)
  -V, --version           Output the version number
  -h, --help              Display help for command
```

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

Note: The tool will attempt to take a screenshot after the specified timeout even if the page is still loading. Playwright has a fixed maximum timeout of 30 seconds for network idle.

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

## CI/CD

This project uses GitHub Actions for continuous integration and deployment:

### Continuous Integration

The CI workflow runs on pull requests to the main branch and includes:
- Automated testing
- Code linting
- Build verification

### Publishing to npm

Automatic publishing to npm occurs when changes are merged to the `main` branch.

To set up automatic publishing:

1. Generate an npm token with publishing rights
2. Add the token as a repository secret named `NPM_TOKEN` in your GitHub repository settings

## Contributors

- [Rosbel](https://github.com/rosbel) - Project creator
- [Claude AI](https://claude.ai/code) - Development support & documentation

## License

MIT

<!-- Refs -->

[npm-v-src]: https://flat.badgen.net/npm/v/@rosbel/crawl-n-snap/latest
[npm-v-href]: https://npmjs.com/package/@rosbel/crawl-n-snap
[npm-dm-src]: https://flat.badgen.net/npm/dm/@rosbel/crawl-n-snap
[npm-dm-href]: https://npmjs.com/package/rosbel/crawl-n-snap
[packagephobia-src]: https://flat.badgen.net/packagephobia/install/@rosbel/crawl-n-snap
[packagephobia-href]: https://packagephobia.now.sh/result?p=@rosbel/crawl-n-snap
[ci-status-src]: https://img.shields.io/github/actions/workflow/status/rosbel/crawl-n-snap/.github%2Fworkflows%2Fci.yml?label=tests
[ci-status-href]: https://github.com/rosbel/crawl-n-snap/actions/workflows/ci.yml
[publish-status-src]: https://img.shields.io/github/actions/workflow/status/rosbel/crawl-n-snap/.github%2Fworkflows%2Fnpm-publish.yml?label=publish
[publish-status-href]: https://github.com/rosbel/crawl-n-snap/actions/workflows/npm-publish.yml
[license-src]: https://img.shields.io/github/license/rosbel/crawl-n-snap
[license-href]: https://github.com/rosbel/crawl-n-snap/blob/main/LICENSE
