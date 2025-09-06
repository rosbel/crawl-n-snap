#!/usr/bin/env node
// src/index.ts

import {program} from 'commander';
import playwright, {BrowserType, Page} from 'playwright';
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
  concurrency: number;
  retries: number;
  excludePatterns: string[];
  includePatterns: string[];
  continueOnError: boolean;
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  delay: number;
  fullPage: boolean;
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

// Function to merge config file with CLI options (CLI takes precedence)
function mergeConfigWithOptions(config: ConfigFile | null, cliOptions: any): any {
  if (!config) return cliOptions;

  // Merge exclude patterns from both CLI and config
  const excludePatterns = [...(cliOptions.excludePattern || []), ...(config.excludePatterns || [])];
  const includePatterns = [...(cliOptions.includePattern || []), ...(config.includePatterns || [])];

  const allowedWaitUntil = ['load', 'domcontentloaded', 'networkidle', 'commit'] as const;
  const safeWaitUntil = (val: any) =>
    allowedWaitUntil.includes(val) ? val : (undefined as unknown as never);

  return {
    resolution:
      cliOptions.resolution.length === 1 &&
      cliOptions.resolution[0].width === 1920 &&
      cliOptions.resolution[0].height === 1080
        ? config.resolutions?.map(parseResolution) || cliOptions.resolution // Use config if CLI has default
        : cliOptions.resolution, // Use CLI if custom resolutions provided
    output: cliOptions.output !== '.' ? cliOptions.output : config.output || cliOptions.output,
    browser:
      cliOptions.browser !== 'chromium' ? cliOptions.browser : config.browser || cliOptions.browser,
    crawl: cliOptions.crawl || config.crawl || false,
    maxPages:
      cliOptions.maxPages !== 50 ? cliOptions.maxPages : config.maxPages || cliOptions.maxPages,
    timeout:
      cliOptions.timeout !== 5000 ? cliOptions.timeout : config.timeout || cliOptions.timeout,
    concurrency:
      cliOptions.concurrency !== 3
        ? cliOptions.concurrency
        : config.concurrency || cliOptions.concurrency,
    retries: cliOptions.retries !== 2 ? cliOptions.retries : (config.retries ?? cliOptions.retries),
    excludePattern: excludePatterns,
    includePattern: includePatterns,
    continueOnError: cliOptions.failFast
      ? false
      : (cliOptions.continueOnError ?? config.continueOnError ?? true),
    desktop: cliOptions.desktop || config.desktop || false,
    mobile: cliOptions.mobile || config.mobile || false,
    waitUntil:
      cliOptions.waitUntil !== 'networkidle'
        ? cliOptions.waitUntil
        : safeWaitUntil(config.waitUntil) || cliOptions.waitUntil,
    delay: cliOptions.delay !== 0 ? cliOptions.delay : (config.delay ?? cliOptions.delay),
    fullPage:
      typeof cliOptions.fullPage === 'boolean' ? cliOptions.fullPage : (config.fullPage ?? true),
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

// Helper function to limit concurrency using a semaphore-like approach
async function limitConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const promise = task().then((result) => {
      results.push(result);
    });

    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex((p) => p === promise),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
}

// Helper function to retry operations with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error = new Error('No attempts made');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
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
    console.error(`Invalid URL: ${error.message}`);
  }

  // Parse string resolutions to Resolution objects
  const parsedResolutions: Resolution[] = options.resolutions.map((res) => parseResolution(res));

  console.log(`Target URL: ${targetUrl}`);
  console.log(`Browser: ${options.browser}`);
  console.log(`Output Directory: ${path.resolve(options.output)}`);
  console.log(`Early Screenshot Timeout: ${options.timeout}ms, Playwright Max Timeout: 30000ms`);
  console.log(
    `Wait Until: ${options.waitUntil}; Delay before screenshot: ${options.delay}ms; Full Page: ${options.fullPage}`
  );
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
    browser = await browserType.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    console.log('Browser launched successfully.');

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
        // Navigate to the URL only once
        console.log(`- Navigating to ${normalizedUrl}...`);
        try {
          // Use fixed 30 second timeout for Playwright
          const navigationPromise = page.goto(normalizedUrl, {
            waitUntil: options.waitUntil,
            timeout: 30000, // Fixed Playwright timeout
          });

          // Race between networkidle and user-specified timeout
          await Promise.race([
            navigationPromise,
            new Promise((resolve) => setTimeout(resolve, options.timeout)),
          ]);
          console.log(
            `- Navigation complete (either networkidle or ${options.timeout}ms timeout reached).`
          );
        } catch (error: any) {
          if (error.name === 'TimeoutError') {
            console.log(
              `- Playwright navigation timeout reached (30000ms). Continuing with screenshot.`
            );
          } else {
            throw error; // Rethrow other errors
          }
        }

        // Process all resolutions with controlled concurrency for better performance
        console.log(
          `\nProcessing ${parsedResolutions.length} resolutions (max ${options.concurrency} concurrent)...`
        );

        const screenshotTasks = parsedResolutions.map((resolution) => {
          const {width, height} = resolution;
          const resolutionString = `${width}x${height}`;

          return async () => {
            try {
              // Wrap screenshot operation in retry logic
              const result = await retryWithBackoff(async () => {
                // Create a new page for each resolution to avoid conflicts
                const resolutionPage = await context.newPage();

                try {
                  // Navigate to the URL with timeout handling
                  try {
                    const navigationPromise = resolutionPage.goto(normalizedUrl, {
                      waitUntil: options.waitUntil,
                      timeout: 30000,
                    });

                    // Race between networkidle and user-specified timeout
                    await Promise.race([
                      navigationPromise,
                      new Promise((resolve) => setTimeout(resolve, options.timeout)),
                    ]);
                  } catch (error: any) {
                    if (error.name !== 'TimeoutError') {
                      throw error;
                    }
                    // Continue with screenshot if timeout
                  }

                  // Set viewport for this resolution
                  await resolutionPage.setViewportSize({width, height});

                  // Optional delay before screenshot
                  if (options.delay > 0) {
                    await new Promise((resolve) => setTimeout(resolve, options.delay));
                  }

                  // Get sanitized path for the current URL
                  const url = new URL(normalizedUrl);
                  const sanitizedPath = sanitizePath(url.pathname);
                  const sanitizedQ = sanitizeQuery(url.search);

                  // Generate filename
                  const filename = `${resolutionString}-${sanitizedPath}${sanitizedQ ? `__${sanitizedQ}` : ''}.png`;
                  const outputPath = path.join(screenshotBaseDir, filename);

                  // Take screenshot
                  await resolutionPage.screenshot({path: outputPath, fullPage: options.fullPage});

                  return {outputPath};
                } finally {
                  // Always close the page to free memory
                  await resolutionPage.close();
                }
              }, options.retries);

              return {
                success: true,
                resolution: resolutionString,
                outputPath: result.outputPath,
                attempts: options.retries + 1,
              };
            } catch (error: any) {
              return {
                success: false,
                resolution: resolutionString,
                error: error.message,
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
        console.log('\nFirst 10 errors (use --continue-on-error=false to stop on first error):');
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
        concurrency: options.concurrency,
        retries: options.retries,
        continueOnError: options.continueOnError,
        waitUntil: options.waitUntil,
        delay: options.delay,
        fullPage: options.fullPage,
        includePatterns: options.includePatterns,
        excludePatterns: options.excludePatterns,
        resolutions: parsedResolutions.map((r) => `${r.width}x${r.height}`),
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
    'Custom screen resolution (e.g., 1920x1080). Repeatable.',
    collectResolutions,
    [parseResolution('1920x1080')] // Default if no preset or custom resolution provided
  )
  .option('-d, --desktop', 'Capture desktop resolutions (1920x1080, 1366x768, 1440x900)')
  .option('-m, --mobile', 'Capture mobile resolutions (375x667, 390x844, 360x640)')
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
    '-p, --max-pages <name>',
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
    'Early screenshot timeout in milliseconds (defaults to 5000)',
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
    'Playwright navigation waitUntil state (load | domcontentloaded | networkidle | commit). Default: networkidle',
    (value: string) => {
      const v = value.toLowerCase();
      const allowed = ['load', 'domcontentloaded', 'networkidle', 'commit'];
      if (!allowed.includes(v)) {
        throw new Error(`Invalid wait-until state. Choose from: ${allowed.join(', ')}`);
      }
      return v as any;
    },
    'networkidle'
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
        concurrency: number;
        retries: number;
        excludePattern: string[];
        includePattern: string[];
        continueOnError: boolean;
        failFast: boolean;
        waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
        delay: number;
        fullPage: boolean;
      }
    ) => {
      try {
        // Load configuration file first
        const configFile = await loadConfigFile();

        // Merge config file with CLI options (CLI takes precedence)
        const mergedOptions = mergeConfigWithOptions(configFile, options);

        // Handle device presets
        let resolutions = [...mergedOptions.resolution]; // Start with merged resolutions

        if (mergedOptions.desktop) {
          resolutions = [...resolutions, ...devicePresets.desktop];
        }

        if (mergedOptions.mobile) {
          resolutions = [...resolutions, ...devicePresets.mobile];
        }

        // Remove duplicates (based on width and height)
        const uniqueResolutions = Array.from(
          new Map(resolutions.map((r) => [`${r.width}x${r.height}`, r])).values()
        );

        // Map merged options to our interface
        const mappedOptions: CliOptions = {
          resolutions: uniqueResolutions.map((r) => `${r.width}x${r.height}`),
          output: mergedOptions.output,
          browser: mergedOptions.browser,
          crawl: mergedOptions.crawl,
          maxPages: mergedOptions.maxPages,
          timeout: mergedOptions.timeout,
          concurrency: mergedOptions.concurrency,
          retries: mergedOptions.retries,
          excludePatterns: mergedOptions.excludePattern,
          includePatterns: mergedOptions.includePattern,
          continueOnError: mergedOptions.continueOnError,
          waitUntil: mergedOptions.waitUntil,
          delay: mergedOptions.delay,
          fullPage: mergedOptions.fullPage,
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

// Only parse args if the script is run directly
if (require.main === module) {
  program.parseAsync(process.argv).catch((err) => {
    console.error('Failed to parse arguments or run command:', err);
    process.exit(1);
  });
}

// Export for potential programmatic use (optional)
export {runScreenshotter, CliOptions};
