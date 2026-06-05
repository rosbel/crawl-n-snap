#!/usr/bin/env node
// src/index.ts

import {program} from 'commander';
import playwright, {BrowserType, Page, BrowserContextOptions} from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import {URL} from 'url';
import {
  Resolution,
  parseResolution,
  collectResolutions,
  sanitizePath,
  normalizeUrl,
  sanitizeQuery,
} from './utils';
import os from 'os';

// Define valid browser types for Playwright
type SupportedBrowser = 'chromium' | 'firefox' | 'webkit';
const supportedBrowsers: SupportedBrowser[] = ['chromium', 'firefox', 'webkit'];

interface CliOptions {
  resolutions: string[];
  output: string;
  browser: SupportedBrowser;
  crawl: boolean;
  maxPages: number;
  timeout: number;
  navTimeout: number;
  concurrency: number;
  retries: number;
  excludePatterns: string[];
  includePatterns: string[];
  continueOnError: boolean;
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  delay: number;
  fullPage: boolean;
  headless: boolean;
  format: 'png' | 'jpeg';
  quality?: number;
  selector?: string;
  clip?: ClipRegion;
  waitForSelector?: string;
  disableAnimations: boolean;
  scale: number;
  colorScheme?: 'light' | 'dark' | 'no-preference';
  userAgent?: string;
  device?: string;
  headers?: Record<string, string>;
  basicAuth?: {username: string; password: string};
  storageState?: string;
}

interface ClipRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ErrorSummary {
  url: string;
  error: string;
  type: 'navigation' | 'screenshot' | 'linkExtraction' | 'fileSystem' | 'unknown';
  timestamp: string;
}

interface ConfigFile {
  resolutions?: string[];
  output?: string;
  browser?: SupportedBrowser;
  crawl?: boolean;
  maxPages?: number;
  timeout?: number;
  navTimeout?: number;
  concurrency?: number;
  retries?: number;
  continueOnError?: boolean;
  desktop?: boolean;
  mobile?: boolean;
  excludePatterns?: string[];
  includePatterns?: string[];
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' | string;
  delay?: number;
  fullPage?: boolean;
  headless?: boolean;
  format?: 'png' | 'jpeg' | string;
  quality?: number;
  selector?: string;
  clip?: string;
  waitForSelector?: string;
  disableAnimations?: boolean;
  scale?: number;
  colorScheme?: 'light' | 'dark' | 'no-preference' | string;
  userAgent?: string;
  device?: string;
  headers?: string[];
  basicAuth?: string;
  storageState?: string;
}

// Parse a --clip value "x,y,width,height" into a region. x/y must be >= 0 and
// width/height > 0.
function parseClip(value: string): ClipRegion {
  const parts = value.split(',').map((p) => p.trim());
  if (parts.length !== 4) {
    throw new Error(`Invalid --clip "${value}". Use x,y,width,height (e.g. 0,0,800,600).`);
  }
  const [x, y, width, height] = parts.map((p) => Number(p));
  if (
    [x, y, width, height].some((n) => !Number.isFinite(n)) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`Invalid --clip "${value}". x,y must be >= 0 and width,height > 0.`);
  }
  return {x, y, width, height};
}

// Parse "Name: value" header strings into a header map. Splits on the first
// colon so values may themselves contain colons.
function parseHeaders(list: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const raw of list) {
    const idx = raw.indexOf(':');
    if (idx === -1) {
      throw new Error(`Invalid --header "${raw}". Use "Name: value".`);
    }
    const name = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (!name) throw new Error(`Invalid --header "${raw}". Header name is empty.`);
    headers[name] = value;
  }
  return headers;
}

// Parse "user:password" basic-auth credentials (password may contain colons).
function parseBasicAuth(value: string): {username: string; password: string} {
  const idx = value.indexOf(':');
  if (idx === -1) {
    throw new Error('Invalid --basic-auth. Use "username:password".');
  }
  return {username: value.slice(0, idx), password: value.slice(idx + 1)};
}

// --- Configuration File Support ---

// Function to find and load configuration file
async function loadConfigFile(): Promise<ConfigFile | null> {
  const configFilenames = ['.crawlsnaprc.json', '.crawlsnaprc'];
  const searchPaths = [
    process.cwd(), // Current directory
    os.homedir(), // Home directory
  ];

  for (const searchPath of searchPaths) {
    for (const filename of configFilenames) {
      const configPath = path.join(searchPath, filename);
      try {
        const configContent = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configContent) as ConfigFile;

        // Validate browser if specified
        if (config.browser && !supportedBrowsers.includes(config.browser)) {
          console.warn(`Invalid browser "${config.browser}" in ${configPath}. Using default.`);
          delete config.browser;
        }

        console.log(`Using configuration from: ${configPath}`);
        return config;
      } catch (error: any) {
        // File doesn't exist or is invalid, continue searching
        if (error.code !== 'ENOENT') {
          console.warn(`Warning: Could not parse config file ${configPath}: ${error.message}`);
        }
      }
    }
  }

  return null;
}

// Where a Commander option's value came from (e.g. 'cli', 'default', 'config').
// Mirrors the return of program.getOptionValueSource(); injected so the merge
// is unit-testable without depending on Commander's global parse state.
type GetOptionSource = (name: string) => string | undefined;

// Fallback used when no source information is available (treat everything as
// at its default, so config values win wherever present).
const allDefaultSources: GetOptionSource = () => 'default';

// Merge a loaded config file with parsed CLI options. Precedence is:
//   explicit CLI flag  >  config file value  >  CLI default.
// `getSource` tells us whether the user actually typed an option (source
// 'cli') versus it sitting at its default — without it we could not tell an
// explicit `--timeout 5000` apart from the 5000 default, which previously let
// the config file override values the user had explicitly set.
function mergeConfigWithOptions(
  config: ConfigFile | null,
  cliOptions: any,
  getSource: GetOptionSource = allDefaultSources
): any {
  if (!config) return cliOptions;

  // Merge list options from both CLI and config (additive, not override).
  const excludePatterns = [...(cliOptions.excludePattern || []), ...(config.excludePatterns || [])];
  const includePatterns = [...(cliOptions.includePattern || []), ...(config.includePatterns || [])];

  const allowedWaitUntil = ['load', 'domcontentloaded', 'networkidle', 'commit'];
  const safeWaitUntil = (val: any) => (allowedWaitUntil.includes(val) ? val : undefined);

  const fromCli = (name: string) => getSource(name) === 'cli';
  // CLI value if the user set it, else the config value when present, else the
  // CLI default. `??` (not `||`) so legitimate falsy values like 0 / false from
  // the config are honored.
  const pick = <T>(name: string, cliValue: T, configValue: T | undefined): T =>
    fromCli(name) ? cliValue : (configValue ?? cliValue);

  return {
    resolution: fromCli('resolution')
      ? cliOptions.resolution
      : (config.resolutions?.map(parseResolution) ?? cliOptions.resolution),
    output: pick('output', cliOptions.output, config.output),
    browser: pick('browser', cliOptions.browser, config.browser),
    crawl: pick('crawl', cliOptions.crawl, config.crawl),
    maxPages: pick('maxPages', cliOptions.maxPages, config.maxPages),
    timeout: pick('timeout', cliOptions.timeout, config.timeout),
    navTimeout: pick('navTimeout', cliOptions.navTimeout, config.navTimeout),
    concurrency: pick('concurrency', cliOptions.concurrency, config.concurrency),
    retries: pick('retries', cliOptions.retries, config.retries),
    excludePattern: excludePatterns,
    includePattern: includePatterns,
    continueOnError: cliOptions.failFast
      ? false
      : pick('continueOnError', cliOptions.continueOnError, config.continueOnError),
    desktop: pick('desktop', cliOptions.desktop, config.desktop),
    mobile: pick('mobile', cliOptions.mobile, config.mobile),
    waitUntil: pick('waitUntil', cliOptions.waitUntil, safeWaitUntil(config.waitUntil)),
    delay: pick('delay', cliOptions.delay, config.delay),
    fullPage: pick('fullPage', cliOptions.fullPage, config.fullPage),
    headless: pick('headless', cliOptions.headless, config.headless),
    format: pick('format', cliOptions.format, config.format),
    quality: pick('quality', cliOptions.quality, config.quality),
    selector: pick('selector', cliOptions.selector, config.selector),
    clip: pick('clip', cliOptions.clip, config.clip),
    waitForSelector: pick('waitForSelector', cliOptions.waitForSelector, config.waitForSelector),
    disableAnimations: pick(
      'disableAnimations',
      cliOptions.disableAnimations,
      config.disableAnimations
    ),
    scale: pick('scale', cliOptions.scale, config.scale),
    colorScheme: pick('colorScheme', cliOptions.colorScheme, config.colorScheme),
    userAgent: pick('userAgent', cliOptions.userAgent, config.userAgent),
    device: pick('device', cliOptions.device, config.device),
    // Headers merge additively (CLI first, then config).
    header: [...(cliOptions.header || []), ...(config.headers || [])],
    basicAuth: pick('basicAuth', cliOptions.basicAuth, config.basicAuth),
    storageState: pick('storageState', cliOptions.storageState, config.storageState),
  };
}

// Function to check if a URL matches any exclusion pattern
function isUrlExcluded(url: string, excludePatterns: string[]): boolean {
  if (excludePatterns.length === 0) return false;

  return excludePatterns.some((pattern) => {
    // Convert glob-like pattern to regex
    // Replace * with .* and escape other regex special characters
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\?]/g, '\\$&') // Escape regex special chars except *
      .replace(/\*/g, '.*'); // Convert * to .*

    const regex = new RegExp(`^${regexPattern}$`, 'i'); // Case insensitive
    return regex.test(url);
  });
}

// Function to check if a URL matches include patterns (if present)
function isUrlIncluded(url: string, includePatterns: string[]): boolean {
  if (!includePatterns || includePatterns.length === 0) return true; // Include all if none provided
  return includePatterns.some((pattern) => {
    const regexPattern = pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(url);
  });
}

// Function to classify errors for better reporting
function classifyError(error: any): ErrorSummary['type'] {
  const errorMessage = error?.message?.toLowerCase() || '';

  if (error?.name === 'TimeoutError' || errorMessage.includes('timeout')) {
    return 'navigation';
  }
  if (errorMessage.includes('screenshot') || errorMessage.includes('page.screenshot')) {
    return 'screenshot';
  }
  if (
    errorMessage.includes('enoent') ||
    errorMessage.includes('permission') ||
    errorMessage.includes('mkdir')
  ) {
    return 'fileSystem';
  }
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('net::') ||
    errorMessage.includes('connection')
  ) {
    return 'navigation';
  }
  if (errorMessage.includes('evaluate') || errorMessage.includes('link')) {
    return 'linkExtraction';
  }

  return 'unknown';
}

// Function to create error summary
function createErrorSummary(url: string, error: any): ErrorSummary {
  return {
    url,
    error: error?.message || String(error),
    type: classifyError(error),
    timestamp: new Date().toISOString(),
  };
}

// --- Main Logic ---

// Helper function to limit concurrency using a semaphore-like approach.
// Runs at most `limit` tasks at once, preserves input order in the returned
// results array, and waits for every task to settle before resolving.
async function limitConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const maxInFlight = Math.max(1, Math.floor(limit));
  const executing = new Set<Promise<void>>();

  for (let idx = 0; idx < tasks.length; idx++) {
    // Write each result into its input slot so ordering is deterministic
    // regardless of which task finishes first.
    const run = (async () => {
      results[idx] = await tasks[idx]();
    })();

    // Track the in-flight promise and ensure it removes itself when settled,
    // so the `executing` set accurately reflects the live workers.
    const tracked: Promise<void> = run.finally(() => {
      executing.delete(tracked);
    });
    executing.add(tracked);

    // Once we hit the cap, wait for at least one worker to free a slot.
    if (executing.size >= maxInFlight) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

// Helper function to retry operations with exponential backoff. Returns the
// operation's value along with how many attempts it actually took (1 = first
// try succeeded), so callers can report retries truthfully instead of assuming
// the maximum.
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  baseDelay: number = 1000
): Promise<{value: T; attempts: number}> {
  let lastError: Error = new Error('No attempts made');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const value = await operation();
      return {value, attempts: attempt + 1};
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries) {
        throw lastError;
      }

      // Exponential backoff: 1s, 2s, 4s, 8s...
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`  Retry ${attempt + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Navigate to a URL, racing the user's "early screenshot" timeout against the
// hard navigation cap. Resolves as soon as the page reaches `waitUntil` OR the
// early timeout elapses, so we can still screenshot a slow/never-idle page.
// Real navigation failures (DNS, connection refused) that occur before the
// early timeout are surfaced; the hard-cap TimeoutError is swallowed so the
// caller proceeds with whatever has rendered. Always clears its timer and never
// leaves a dangling unhandled rejection on the abandoned goto.
async function navigateWithEarlyTimeout(
  page: Page,
  url: string,
  waitUntil: CliOptions['waitUntil'],
  earlyTimeout: number,
  navTimeout: number
): Promise<void> {
  const navigation = page.goto(url, {waitUntil, timeout: navTimeout}).then(() => undefined);
  // If we abandon the navigation after the early timeout wins, make sure its
  // eventual settlement (e.g. "Target closed" once we close the page) does not
  // surface as an unhandled rejection.
  navigation.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const earlyExit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, earlyTimeout);
  });

  try {
    await Promise.race([navigation, earlyExit]);
  } catch (error: any) {
    // Navigation rejected before the early timeout. The hard-cap timeout is
    // expected (proceed with partial render); anything else is a real failure.
    if (error?.name !== 'TimeoutError') {
      throw error;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function extractLinks(page: Page, baseUrl: string): Promise<string[]> {
  const url = new URL(baseUrl);
  const baseOrigin = url.origin;
  const basePath = url.pathname;

  // Extract all links from the page
  const links = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    return anchors.map((a) => a.getAttribute('href')).filter((href) => href !== null) as string[];
  });

  // Filter and normalize links
  return links
    .map((link) => {
      try {
        // Handle absolute URLs
        if (link.startsWith('http://') || link.startsWith('https://')) {
          const linkUrl = new URL(link);
          // Only include links from the same origin
          if (linkUrl.origin === baseOrigin) {
            return normalizeUrl(link);
          }
          return null;
        }

        // Handle relative URLs
        if (link.startsWith('/')) {
          // Absolute path within the same domain
          return normalizeUrl(`${baseOrigin}${link}`);
        } else if (
          !link.startsWith('#') &&
          !link.startsWith('javascript:') &&
          !link.startsWith('mailto:') &&
          !link.startsWith('tel:')
        ) {
          // Relative path, resolve against current URL
          const currentPath = basePath.endsWith('/')
            ? basePath
            : `${basePath.substring(0, basePath.lastIndexOf('/') + 1)}`;
          return normalizeUrl(`${baseOrigin}${currentPath}${link}`);
        }

        return null;
      } catch {
        console.warn(`Invalid URL: ${link}`);
        return null;
      }
    })
    .filter((link): link is string => link !== null && !link.includes('#')); // Remove hash fragments and nulls
}

// Helper function has been moved to utils.ts

async function runScreenshotter(targetUrl: string, options: CliOptions) {
  let browser: playwright.Browser | null = null;

  // Normalize the target URL to handle slash consistency
  targetUrl = normalizeUrl(targetUrl);
  try {
    new URL(targetUrl); // Validate URL format early
  } catch (error: any) {
    // Fail fast instead of launching a browser and crashing later with a less
    // helpful error deeper in the run.
    throw new Error(`Invalid URL "${targetUrl}": ${error.message}`);
  }

  // Parse string resolutions to Resolution objects
  const parsedResolutions: Resolution[] = options.resolutions.map((res) => parseResolution(res));

  console.log(`Target URL: ${targetUrl}`);
  console.log(`Browser: ${options.browser}`);
  console.log(`Output Directory: ${path.resolve(options.output)}`);
  console.log(
    `Early Screenshot Timeout: ${options.timeout}ms, Navigation Timeout: ${options.navTimeout}ms`
  );
  console.log(
    `Wait Until: ${options.waitUntil}; Delay before screenshot: ${options.delay}ms; Full Page: ${options.fullPage}`
  );
  const captureMode = options.selector
    ? `element (${options.selector})`
    : options.clip
      ? `clip (${options.clip.x},${options.clip.y},${options.clip.width},${options.clip.height})`
      : options.fullPage
        ? 'full page'
        : 'viewport';
  const qualityInfo =
    options.format === 'jpeg' && options.quality != null ? ` (quality ${options.quality})` : '';
  console.log(
    `Format: ${options.format}${qualityInfo}; Capture: ${captureMode}` +
      `${options.disableAnimations ? '; animations disabled' : ''}` +
      `${options.waitForSelector ? `; wait-for: ${options.waitForSelector}` : ''}`
  );
  // Emulation/auth banner. Never print secret values (auth, headers, storage).
  const emulationBits: string[] = [];
  if (options.device) emulationBits.push(`device: ${options.device}`);
  if (options.scale && options.scale !== 1) emulationBits.push(`scale: ${options.scale}x`);
  if (options.colorScheme) emulationBits.push(`color-scheme: ${options.colorScheme}`);
  if (options.userAgent) emulationBits.push('custom user-agent');
  if (emulationBits.length) console.log(`Emulation: ${emulationBits.join('; ')}`);
  const authBits: string[] = [];
  if (options.basicAuth) authBits.push('basic-auth');
  if (options.headers && Object.keys(options.headers).length) {
    authBits.push(`${Object.keys(options.headers).length} custom header(s)`);
  }
  if (options.storageState) authBits.push('storage-state');
  if (authBits.length) console.log(`Auth: ${authBits.join('; ')} (values hidden)`);
  console.log(`Headless: ${options.headless}`);
  console.log(`Crawl Mode: ${options.crawl ? 'Enabled' : 'Disabled'}`);
  if (options.crawl) {
    console.log(`Max Pages: ${options.maxPages}`);
    if (options.excludePatterns.length > 0) {
      console.log(`Exclude Patterns: ${options.excludePatterns.join(', ')}`);
    }
    if (options.includePatterns.length > 0) {
      console.log(`Include Patterns: ${options.includePatterns.join(', ')}`);
    }
  }
  console.log(`Retry Attempts: ${options.retries}`);
  console.log(`Concurrency: ${options.concurrency}`);
  console.log('Resolutions to capture:');
  parsedResolutions.forEach((res) => console.log(`- ${res.width}x${res.height}`));
  console.log('---');

  try {
    // Ensure output directory exists
    await fs.mkdir(options.output, {recursive: true});
    console.log(`Ensured output directory exists: ${options.output}`);

    // Launch Browser
    const browserType: BrowserType = playwright[options.browser];
    console.log(`Launching ${options.browser}...`);
    browser = await browserType.launch({headless: options.headless});

    // Build context options for emulation/auth. Start from a device descriptor
    // (if --device), then layer explicit overrides on top. Only keys the user
    // actually set are included, so the no-flag path stays a plain context.
    const deviceDescriptor = options.device ? playwright.devices[options.device] : undefined;
    const contextOptions: BrowserContextOptions = {...(deviceDescriptor || {})};
    if (options.scale && options.scale !== 1) contextOptions.deviceScaleFactor = options.scale;
    if (options.colorScheme) contextOptions.colorScheme = options.colorScheme;
    if (options.userAgent) contextOptions.userAgent = options.userAgent;
    if (options.headers && Object.keys(options.headers).length) {
      contextOptions.extraHTTPHeaders = options.headers;
    }
    if (options.basicAuth) contextOptions.httpCredentials = options.basicAuth;
    if (options.storageState) contextOptions.storageState = options.storageState;

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    console.log('Browser launched successfully.');

    // When emulating a device, the descriptor defines the viewport/DPR/touch, so
    // capture a single shot labeled by the device instead of iterating -r sizes.
    const useDeviceViewport = Boolean(deviceDescriptor);
    type CaptureTarget = {label: string; viewport?: {width: number; height: number}};
    const captureTargets: CaptureTarget[] = useDeviceViewport
      ? [
          {
            label:
              options.device!.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'device',
          },
        ]
      : parsedResolutions.map((r) => ({
          label: `${r.width}x${r.height}`,
          viewport: {width: r.width, height: r.height},
        }));

    // Track visited URLs to avoid loops (using normalized URLs)
    const visitedUrls = new Set<string>();
    const pendingUrls: string[] = [targetUrl];
    let processedCount = 0;
    const errorSummaries: ErrorSummary[] = [];
    const runStartedAt = new Date();
    const perPageResults: Array<{
      url: string;
      results: Array<{
        resolution: string;
        outputPath?: string;
        success: boolean;
        attempts: number;
        error?: string;
      }>;
    }> = [];
    let anyFailures = false;

    // Get the hostname and date for directory structure
    const urlObj = new URL(targetUrl);
    const hostname = urlObj.hostname;
    const date = new Date().toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD format

    // Find the next available run number by checking existing directories
    const baseScreenshotDir = path.join(options.output, 'generated-screenshots', hostname, date);
    await fs.mkdir(baseScreenshotDir, {recursive: true});

    let runNumber = 1;
    try {
      const dirEntries = await fs.readdir(baseScreenshotDir);
      const existingRunDirs = dirEntries
        .filter((entry) => /^\d+$/.test(entry))
        .map((entry) => parseInt(entry, 10))
        .filter((num) => !isNaN(num));

      if (existingRunDirs.length > 0) {
        runNumber = Math.max(...existingRunDirs) + 1;
      }
    } catch {
      // Directory might not exist yet, which is fine
    }

    console.log(`Using run number: ${runNumber}`);

    // Create the full screenshot directory path with run number
    const screenshotBaseDir = path.join(baseScreenshotDir, runNumber.toString());
    await fs.mkdir(screenshotBaseDir, {recursive: true});

    // Process URLs until we run out or hit the limit
    while (pendingUrls.length > 0 && processedCount < options.maxPages) {
      const currentUrl = pendingUrls.shift()!;
      const normalizedUrl = normalizeUrl(currentUrl);

      // Skip if already visited
      if (visitedUrls.has(normalizedUrl)) {
        continue;
      }

      // Mark as visited
      visitedUrls.add(normalizedUrl);
      processedCount++;

      console.log(`\n[${processedCount}/${options.maxPages}] Processing URL: ${normalizedUrl}`);

      try {
        // The shared page is used ONLY for link extraction during a crawl. In
        // the default (non-crawl) path it produces no output, so navigating it
        // is wasted work — each resolution loads the URL on its own page below.
        if (options.crawl) {
          console.log(`- Navigating to ${normalizedUrl} (for link extraction)...`);
          await navigateWithEarlyTimeout(
            page,
            normalizedUrl,
            options.waitUntil,
            options.timeout,
            options.navTimeout
          );
        }

        // Process all capture targets with controlled concurrency for better performance
        console.log(
          `\nProcessing ${captureTargets.length} ${useDeviceViewport ? 'capture' : 'resolutions'} (max ${options.concurrency} concurrent)...`
        );

        const screenshotTasks = captureTargets.map((target) => {
          const resolutionString = target.label;

          return async () => {
            try {
              // Wrap screenshot operation in retry logic
              const result = await retryWithBackoff(async () => {
                // Create a new page for each target to avoid conflicts
                const resolutionPage = await context.newPage();

                try {
                  // Set the viewport BEFORE navigating so responsive layouts and
                  // width-based media queries render at the target resolution.
                  // (Skipped when a --device descriptor already sets the viewport.)
                  if (target.viewport) {
                    await resolutionPage.setViewportSize(target.viewport);
                  }

                  // Navigate, racing the early-screenshot timeout against the
                  // hard navigation cap (see navigateWithEarlyTimeout).
                  await navigateWithEarlyTimeout(
                    resolutionPage,
                    normalizedUrl,
                    options.waitUntil,
                    options.timeout,
                    options.navTimeout
                  );

                  // Optionally wait for a specific element to appear before
                  // capturing (more reliable than a fixed --delay).
                  if (options.waitForSelector) {
                    try {
                      await resolutionPage.waitForSelector(options.waitForSelector, {
                        timeout: options.navTimeout,
                      });
                    } catch {
                      throw new Error(
                        `Timed out waiting for selector "${options.waitForSelector}"`
                      );
                    }
                  }

                  // Optional delay before screenshot
                  if (options.delay > 0) {
                    await new Promise((resolve) => setTimeout(resolve, options.delay));
                  }

                  // Get sanitized path for the current URL
                  const url = new URL(normalizedUrl);
                  const sanitizedPath = sanitizePath(url.pathname);
                  const sanitizedQ = sanitizeQuery(url.search);

                  // Generate filename (extension follows the chosen format)
                  const ext = options.format === 'jpeg' ? 'jpg' : 'png';
                  const filename = `${resolutionString}-${sanitizedPath}${sanitizedQ ? `__${sanitizedQ}` : ''}.${ext}`;
                  const outputPath = path.join(screenshotBaseDir, filename);

                  // Common screenshot options. Quality only applies to jpeg.
                  const shotOptions: Parameters<typeof resolutionPage.screenshot>[0] = {
                    path: outputPath,
                    type: options.format,
                  };
                  if (options.format === 'jpeg' && options.quality != null) {
                    shotOptions.quality = options.quality;
                  }
                  if (options.disableAnimations) {
                    shotOptions.animations = 'disabled';
                  }

                  // Capture a single element, a fixed region, or the page.
                  if (options.selector) {
                    const locator = resolutionPage.locator(options.selector);
                    // waitFor auto-waits and tolerates an in-flight navigation
                    // (the nav may have returned early), so the DOM is committed
                    // before we read it. A timeout here means "no such element".
                    try {
                      await locator
                        .first()
                        .waitFor({state: 'attached', timeout: options.navTimeout});
                    } catch {
                      throw new Error(`No element matched selector "${options.selector}"`);
                    }
                    const count = await locator.count();
                    if (count > 1) {
                      throw new Error(
                        `Selector "${options.selector}" matched ${count} elements; expected exactly one`
                      );
                    }
                    await locator.screenshot(shotOptions);
                  } else if (options.clip) {
                    await resolutionPage.screenshot({...shotOptions, clip: options.clip});
                  } else {
                    await resolutionPage.screenshot({...shotOptions, fullPage: options.fullPage});
                  }

                  return {outputPath};
                } finally {
                  // Always close the page to free memory
                  await resolutionPage.close();
                }
              }, options.retries);

              return {
                success: true,
                resolution: resolutionString,
                outputPath: result.value.outputPath,
                // Real number of attempts (1 = succeeded on the first try).
                attempts: result.attempts,
              };
            } catch (error: any) {
              return {
                success: false,
                resolution: resolutionString,
                error: error.message,
                // Failure path exhausts every attempt.
                attempts: options.retries + 1,
              };
            }
          };
        });

        // Execute tasks with concurrency limit
        const results = await limitConcurrency(screenshotTasks, options.concurrency);

        // Process results and report status
        let successCount = 0;
        let failureCount = 0;

        results.forEach((result) => {
          if (result.success) {
            const retryInfo = result.attempts > 1 ? ` (after ${result.attempts - 1} retries)` : '';
            console.log(
              `✓ ${result.resolution} screenshot saved: ${result.outputPath}${retryInfo}`
            );
            successCount++;
          } else {
            console.error(
              `✗ ${result.resolution} failed after ${result.attempts} attempts: ${result.error}`
            );
            failureCount++;
          }
        });

        perPageResults.push({
          url: normalizedUrl,
          results: results.map((r) => ({
            resolution: r.resolution,
            outputPath: r.outputPath,
            success: r.success,
            attempts: r.attempts,
            error: (r as any).error,
          })),
        });

        console.log(`\nScreenshot summary: ${successCount} successful, ${failureCount} failed`);
        if (failureCount > 0) anyFailures = true;

        // If crawling is enabled, extract and queue more URLs
        if (options.crawl) {
          // The navigation above may have returned early (before `load`), so
          // give the DOM a bounded chance to finish so links injected late are
          // still discovered. Never block past the navigation cap.
          await page.waitForLoadState('load', {timeout: options.navTimeout}).catch(() => {});

          console.log(`- Extracting links from ${normalizedUrl}...`);
          const links = await extractLinks(page, normalizedUrl);
          console.log(`- Found ${links.length} links.`);

          // Add new links to pending queue if not already visited and not excluded
          for (const link of links) {
            const normalizedLink = normalizeUrl(link);
            if (
              !visitedUrls.has(normalizedLink) &&
              !isUrlExcluded(normalizedLink, options.excludePatterns) &&
              isUrlIncluded(normalizedLink, options.includePatterns)
            ) {
              pendingUrls.push(normalizedLink);
            } else if (isUrlExcluded(normalizedLink, options.excludePatterns)) {
              console.log(`  - Excluding URL (matches pattern): ${normalizedLink}`);
            } else if (!isUrlIncluded(normalizedLink, options.includePatterns)) {
              console.log(`  - Skipping URL (does not match include patterns): ${normalizedLink}`);
            }
          }

          console.log(`- Queue size: ${pendingUrls.length}, Visited: ${visitedUrls.size}`);
        }
      } catch (error: any) {
        const errorSummary = createErrorSummary(normalizedUrl, error);
        errorSummaries.push(errorSummary);
        anyFailures = true;

        console.error(`Error processing ${normalizedUrl}: ${error.message}`);
        console.error(`Error type: ${errorSummary.type}`);

        if (!options.continueOnError) {
          console.error('Stopping due to --fail-fast option.');
          throw error;
        }

        console.error('Continuing to next URL...');
      }
    }

    if (options.crawl) {
      console.log(`\nCrawling complete. Processed ${visitedUrls.size} pages.`);
      if (pendingUrls.length > 0) {
        console.log(
          `Reached maximum page limit of ${options.maxPages}. ${pendingUrls.length} URLs not processed.`
        );
      }
    }

    // Report error summary if any errors occurred
    if (errorSummaries.length > 0) {
      console.log(`\n--- Error Summary ---`);
      console.log(`Total errors: ${errorSummaries.length}`);

      // Group errors by type
      const errorsByType = errorSummaries.reduce(
        (acc, error) => {
          acc[error.type] = (acc[error.type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      console.log('Error breakdown by type:');
      Object.entries(errorsByType).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });

      if (errorSummaries.length <= 10) {
        console.log('\nDetailed errors:');
        errorSummaries.forEach((error, index) => {
          console.log(`  ${index + 1}. [${error.type}] ${error.url}: ${error.error}`);
        });
      } else {
        console.log('\nFirst 10 errors (use --fail-fast to stop on the first error):');
        errorSummaries.slice(0, 10).forEach((error, index) => {
          console.log(`  ${index + 1}. [${error.type}] ${error.url}: ${error.error}`);
        });
        console.log(`  ... and ${errorSummaries.length - 10} more errors`);
      }
    } else {
      console.log('\n✓ No errors occurred during processing.');
    }

    // Write run manifest
    const runFinishedAt = new Date();
    const manifest = {
      target: targetUrl,
      startedAt: runStartedAt.toISOString(),
      finishedAt: runFinishedAt.toISOString(),
      options: {
        browser: options.browser,
        output: options.output,
        crawl: options.crawl,
        maxPages: options.maxPages,
        timeout: options.timeout,
        navTimeout: options.navTimeout,
        concurrency: options.concurrency,
        retries: options.retries,
        continueOnError: options.continueOnError,
        waitUntil: options.waitUntil,
        delay: options.delay,
        fullPage: options.fullPage,
        headless: options.headless,
        format: options.format,
        quality: options.quality,
        selector: options.selector,
        clip: options.clip,
        waitForSelector: options.waitForSelector,
        disableAnimations: options.disableAnimations,
        scale: options.scale,
        colorScheme: options.colorScheme,
        userAgent: options.userAgent,
        device: options.device,
        // Auth/secret values are deliberately recorded only as booleans/counts.
        basicAuth: options.basicAuth ? true : undefined,
        customHeaders: options.headers ? Object.keys(options.headers).length : undefined,
        storageState: options.storageState ? true : undefined,
        includePatterns: options.includePatterns,
        excludePatterns: options.excludePatterns,
        resolutions: captureTargets.map((t) => t.label),
      },
      pages: perPageResults,
      errors: errorSummaries,
      summary: {
        pagesProcessed: visitedUrls.size,
        totalErrors: errorSummaries.length,
        anyFailures: anyFailures || errorSummaries.length > 0,
      },
    };
    const manifestPath = path.join(screenshotBaseDir, 'run.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`\nRun manifest written: ${manifestPath}`);

    if (anyFailures || errorSummaries.length > 0) {
      process.exitCode = 1;
    }
  } catch (error: any) {
    console.error('\n--- An Error Occurred ---');
    if (error instanceof Error) {
      console.error(`Error Message: ${error.message}`);
      if (error.stack) {
        console.error(`Stack Trace:\n${error.stack}`);
      }
    } else {
      console.error('Caught an unexpected error type:', error);
    }
    process.exitCode = 1; // Indicate failure
  } finally {
    if (browser) {
      console.log('\nClosing browser...');
      await browser.close();
      console.log('Browser closed.');
    }
  }
}

// --- CLI Setup with Commander ---

// Common device presets
const devicePresets = {
  desktop: [
    parseResolution('1920x1080'),
    // parseResolution('1366x768'),
    // parseResolution('1440x900')
  ],
  mobile: [
    // parseResolution('375x667'),  // iPhone 8
    parseResolution('390x844'), // iPhone 12/13
    // parseResolution('360x640')   // Common Android
  ],
};

// Read package.json to get version
const packageJson = JSON.parse(
  fsSync.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

program
  .version(packageJson.version)
  .description(
    'CLI tool for taking website screenshots at various resolutions using Playwright, with optional website crawling functionality.'
  )
  .argument('<url>', 'The full URL (including http/https) of the page to screenshot.')
  .option<Resolution[]>(
    '-r, --resolution <WxH>',
    'Custom screen resolution (e.g., 1920x1080). Repeatable. If omitted (and no preset), defaults to 1920x1080.',
    collectResolutions,
    [] // Start empty; the default 1920x1080 is applied only when nothing else is provided
  )
  .option('-d, --desktop', 'Add the desktop preset resolution (1920x1080)')
  .option('-m, --mobile', 'Add the mobile preset resolution (390x844)')
  .option('-o, --output <dir>', 'Base output directory for screenshots', '.') // Default to current directory
  .option<SupportedBrowser>(
    '-b, --browser <name>',
    `Browser to use (${supportedBrowsers.join(', ')})`,
    (value: string): SupportedBrowser => {
      const lowerCaseValue = value.toLowerCase() as SupportedBrowser;
      if (!supportedBrowsers.includes(lowerCaseValue)) {
        throw new Error(`Invalid browser. Choose from: ${supportedBrowsers.join(', ')}`);
      }
      return lowerCaseValue;
    },
    'chromium' // Default browser
  )
  .option('-c, --crawl', 'Enable crawling of all relative links on the website', false)
  .option(
    '-p, --max-pages <n>',
    'Maximum number of pages to crawl (only used with --crawl)',
    (value) => {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error('Max pages must be a positive number');
      }
      return parsed;
    },
    50
  ) // Default to 50 pages max
  .option(
    '-t, --timeout <ms>',
    'Early screenshot timeout in milliseconds: take the shot once this elapses even if the page is still loading (defaults to 5000)',
    (value) => {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error('Timeout must be a positive number in milliseconds');
      }
      return parsed;
    },
    5000
  )
  .option(
    '--nav-timeout <ms>',
    'Hard navigation timeout in milliseconds: the maximum Playwright will wait for a page load before giving up (defaults to 30000)',
    (value) => {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error('Navigation timeout must be a positive number in milliseconds');
      }
      return parsed;
    },
    30000
  )
  .option(
    '--concurrency <n>',
    'Maximum number of concurrent screenshot operations (defaults to 3)',
    (value) => {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error('Concurrency must be a positive number');
      }
      return parsed;
    },
    3
  )
  .option(
    '-R, --retries <n>',
    'Number of retry attempts for failed screenshots (defaults to 2)',
    (value) => {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed < 0) {
        throw new Error('Retries must be a non-negative number');
      }
      return parsed;
    },
    2
  )
  .option(
    '-x, --exclude-pattern <pattern>',
    'URL patterns to exclude from crawling (supports wildcards like */admin/*). Repeatable.',
    (value: string, previous: string[] = []) => {
      return previous.concat([value]);
    },
    []
  )
  .option(
    '-i, --include-pattern <pattern>',
    'URL patterns to include when crawling (supports wildcards). If provided, only matching URLs are crawled. Repeatable.',
    (value: string, previous: string[] = []) => previous.concat([value]),
    []
  )
  .option(
    '--continue-on-error',
    'Continue processing other URLs/resolutions when errors occur (default: true)',
    true
  )
  .option('--fail-fast', 'Stop processing immediately when any error occurs', false)
  .option<'load' | 'domcontentloaded' | 'networkidle' | 'commit'>(
    '--wait-until <state>',
    'Playwright navigation waitUntil state (load | domcontentloaded | networkidle | commit). Default: load',
    (value: string) => {
      const v = value.toLowerCase();
      const allowed = ['load', 'domcontentloaded', 'networkidle', 'commit'];
      if (!allowed.includes(v)) {
        throw new Error(`Invalid wait-until state. Choose from: ${allowed.join(', ')}`);
      }
      return v as any;
    },
    'load'
  )
  .option(
    '--delay <ms>',
    'Delay before taking a screenshot after navigation/timeout (milliseconds). Default: 0',
    (value) => {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed < 0) {
        throw new Error('Delay must be a non-negative number');
      }
      return parsed;
    },
    0
  )
  .option('--no-full-page', 'Capture only the visible viewport (default is full page).')
  .option('--no-headless', 'Run browser in headed mode (show UI).')
  .option<'png' | 'jpeg'>(
    '--format <type>',
    'Image format: png or jpeg (default: png)',
    (value: string) => {
      const v = value.toLowerCase();
      if (v !== 'png' && v !== 'jpeg' && v !== 'jpg') {
        throw new Error('Invalid format. Choose from: png, jpeg');
      }
      return (v === 'jpg' ? 'jpeg' : v) as 'png' | 'jpeg';
    },
    'png'
  )
  .option('--quality <1-100>', 'JPEG quality 1-100 (only used with --format jpeg)', (value) => {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 100) {
      throw new Error('Quality must be a number between 1 and 100');
    }
    return parsed;
  })
  .option(
    '--selector <css>',
    'Capture only the element matching this CSS selector (must match exactly one)'
  )
  .option(
    '--clip <x,y,width,height>',
    'Capture only a fixed region of the page (e.g. 0,0,800,600)',
    (value: string) => {
      parseClip(value); // validate eagerly; surfaces a clear error
      return value;
    }
  )
  .option('--wait-for-selector <css>', 'Wait for this CSS selector before capturing')
  .option('--disable-animations', 'Freeze CSS animations/transitions for stable screenshots', false)
  .option(
    '--scale <n>',
    'Device scale factor / DPR (e.g. 2 for retina). Default: 1',
    (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error('Scale must be a number >= 1');
      }
      return parsed;
    },
    1
  )
  .option<'light' | 'dark' | 'no-preference'>(
    '--color-scheme <scheme>',
    'Emulate prefers-color-scheme (light | dark | no-preference)',
    (value: string) => {
      const v = value.toLowerCase();
      if (v !== 'light' && v !== 'dark' && v !== 'no-preference') {
        throw new Error('Invalid color-scheme. Choose from: light, dark, no-preference');
      }
      return v as 'light' | 'dark' | 'no-preference';
    }
  )
  .option('--user-agent <string>', 'Override the browser User-Agent string')
  .option(
    '--device <name>',
    'Emulate a Playwright device (e.g. "iPhone 13"). Overrides -r and sets UA/DPR/touch.',
    (value: string) => {
      if (!playwright.devices[value]) {
        throw new Error(
          `Unknown device "${value}". See Playwright device descriptors (e.g. "iPhone 13", "Pixel 7").`
        );
      }
      return value;
    }
  )
  .option(
    '--header <name:value>',
    'Extra HTTP header to send (e.g. "Authorization: Bearer x"). Repeatable.',
    (value: string, previous: string[] = []) => previous.concat([value]),
    []
  )
  .option('--basic-auth <user:password>', 'HTTP Basic auth credentials for gated pages')
  .option(
    '--storage-state <file.json>',
    'Load cookies/localStorage from a Playwright storageState file'
  )
  .action(
    async (
      url: string,
      options: {
        resolution: Resolution[];
        output: string;
        browser: SupportedBrowser;
        crawl: boolean;
        maxPages: number;
        desktop: boolean;
        mobile: boolean;
        timeout: number;
        navTimeout: number;
        concurrency: number;
        retries: number;
        excludePattern: string[];
        includePattern: string[];
        continueOnError: boolean;
        failFast: boolean;
        waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
        delay: number;
        fullPage: boolean;
        headless: boolean;
        format: 'png' | 'jpeg';
        quality?: number;
        selector?: string;
        clip?: string;
        waitForSelector?: string;
        disableAnimations: boolean;
        scale: number;
        colorScheme?: 'light' | 'dark' | 'no-preference';
        userAgent?: string;
        device?: string;
        header: string[];
        basicAuth?: string;
        storageState?: string;
      }
    ) => {
      try {
        // Load configuration file first
        const configFile = await loadConfigFile();

        // Merge config file with CLI options (explicit CLI flags win over config,
        // which wins over CLI defaults). Pass Commander's option-source lookup so
        // the merge can tell an explicit flag apart from a default.
        const mergedOptions = mergeConfigWithOptions(configFile, options, (name) =>
          program.getOptionValueSource(name)
        );

        // Did the user actually choose resolutions (via -r or the config file)?
        const resolutionFromCli = program.getOptionValueSource('resolution') === 'cli';
        const resolutionFromConfig =
          !resolutionFromCli &&
          Array.isArray(configFile?.resolutions) &&
          configFile.resolutions.length > 0;
        const userChoseResolutions = resolutionFromCli || resolutionFromConfig;

        // Start from the user's explicit resolutions (if any), then layer presets.
        let resolutions = [...mergedOptions.resolution];

        if (mergedOptions.desktop) {
          resolutions = [...resolutions, ...devicePresets.desktop];
        }

        if (mergedOptions.mobile) {
          resolutions = [...resolutions, ...devicePresets.mobile];
        }

        // Fall back to the single default resolution only when the user neither
        // chose resolutions nor selected a preset — so `--mobile` alone no longer
        // silently also captures 1920x1080.
        if (resolutions.length === 0 && !userChoseResolutions) {
          resolutions = [parseResolution('1920x1080')];
        }

        // Remove duplicates (based on width and height)
        const uniqueResolutions = Array.from(
          new Map(resolutions.map((r) => [`${r.width}x${r.height}`, r])).values()
        );

        // --selector and --clip both restrict what is captured; only one makes
        // sense at a time.
        if (mergedOptions.selector && mergedOptions.clip) {
          throw new Error('--selector and --clip cannot be used together.');
        }
        if (mergedOptions.format !== 'jpeg' && mergedOptions.quality != null) {
          console.warn('Note: --quality only applies to --format jpeg; ignoring for png.');
        }
        if (mergedOptions.device && userChoseResolutions) {
          console.warn('Note: --device sets its own viewport; -r resolutions are ignored.');
        }

        const headersMap = (mergedOptions.header || []).length
          ? parseHeaders(mergedOptions.header)
          : undefined;

        // Map merged options to our interface
        const mappedOptions: CliOptions = {
          resolutions: uniqueResolutions.map((r) => `${r.width}x${r.height}`),
          output: mergedOptions.output,
          browser: mergedOptions.browser,
          crawl: mergedOptions.crawl,
          maxPages: mergedOptions.maxPages,
          timeout: mergedOptions.timeout,
          navTimeout: mergedOptions.navTimeout,
          concurrency: mergedOptions.concurrency,
          retries: mergedOptions.retries,
          excludePatterns: mergedOptions.excludePattern,
          includePatterns: mergedOptions.includePattern,
          continueOnError: mergedOptions.continueOnError,
          waitUntil: mergedOptions.waitUntil,
          delay: mergedOptions.delay,
          fullPage: mergedOptions.fullPage,
          headless: mergedOptions.headless,
          format: mergedOptions.format,
          quality: mergedOptions.quality,
          selector: mergedOptions.selector,
          clip: mergedOptions.clip ? parseClip(mergedOptions.clip) : undefined,
          waitForSelector: mergedOptions.waitForSelector,
          disableAnimations: mergedOptions.disableAnimations,
          scale: mergedOptions.scale,
          colorScheme: mergedOptions.colorScheme,
          userAgent: mergedOptions.userAgent,
          device: mergedOptions.device,
          headers: headersMap,
          basicAuth: mergedOptions.basicAuth ? parseBasicAuth(mergedOptions.basicAuth) : undefined,
          storageState: mergedOptions.storageState,
        };

        // Basic URL validation before passing to the main function
        new URL(url);
        await runScreenshotter(url, mappedOptions);
      } catch (error: any) {
        console.error(`\nError: ${error.message}`);
        if (error instanceof TypeError && error.message.includes('Invalid URL')) {
          console.error('Please provide a full URL including http:// or https://');
        }
        process.exit(1);
      }
    }
  );

program.addHelpText(
  'after',
  `
Examples:
  $ crawl-n-snap https://example.com
  $ crawl-n-snap https://example.com -r 1440x900 -r 390x844
  $ crawl-n-snap https://example.com --desktop --mobile
  $ crawl-n-snap https://example.com --crawl --max-pages 25 -x "*/admin/*"
  $ crawl-n-snap https://example.com --wait-until networkidle --delay 500
  $ crawl-n-snap https://example.com -o ./shots --no-full-page`
);

// Only parse args if the script is run directly
if (require.main === module) {
  program.parseAsync(process.argv).catch((err) => {
    console.error('Failed to parse arguments or run command:', err);
    process.exit(1);
  });
}

// Export for potential programmatic use and unit testing.
export {
  runScreenshotter,
  CliOptions,
  limitConcurrency,
  retryWithBackoff,
  mergeConfigWithOptions,
  GetOptionSource,
  parseClip,
  parseHeaders,
  parseBasicAuth,
};
