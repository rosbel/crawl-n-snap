#!/usr/bin/env node
// src/index.ts

import {program} from 'commander';
import playwright, {BrowserType, Page} from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import {URL} from 'url';
import {
    Resolution, 
    parseResolution, 
    collectResolutions, 
    getCurrentDateTimeString, 
    sanitizePath,
    normalizeUrl
} from './utils';

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
}

// --- Main Logic ---

// This function is no longer needed as its functionality has been inlined into runScreenshotter

async function extractLinks(page: Page, baseUrl: string): Promise<string[]> {
    const url = new URL(baseUrl);
    const baseOrigin = url.origin;
    const basePath = url.pathname;
    
    // Extract all links from the page
    const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        return anchors.map(a => a.getAttribute('href')).filter(href => href !== null) as string[];
    });
    
    // Filter and normalize links
    return links
        .map(link => {
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
                } else if (!link.startsWith('#') && !link.startsWith('javascript:') && !link.startsWith('mailto:') && !link.startsWith('tel:')) {
                    // Relative path, resolve against current URL
                    const currentPath = basePath.endsWith('/') ? basePath : `${basePath.substring(0, basePath.lastIndexOf('/') + 1)}`;
                    return normalizeUrl(`${baseOrigin}${currentPath}${link}`);
                }
                
                return null;
            } catch (error) {
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
    const baseUrl = new URL(targetUrl); // Validate URL format early
    
    // Parse string resolutions to Resolution objects
    const parsedResolutions: Resolution[] = options.resolutions.map(res =>
        typeof res === 'string' ? parseResolution(res) : res
    );

    console.log(`Target URL: ${targetUrl}`);
    console.log(`Browser: ${options.browser}`);
    console.log(`Output Directory: ${path.resolve(options.output)}`);
    console.log(`Early Screenshot Timeout: ${options.timeout}ms, Playwright Max Timeout: 30000ms`);
    console.log(`Crawl Mode: ${options.crawl ? 'Enabled' : 'Disabled'}`);
    if (options.crawl) {
        console.log(`Max Pages: ${options.maxPages}`);
    }
    console.log('Resolutions to capture:');
    parsedResolutions.forEach(res => console.log(`- ${res.width}x${res.height}`));
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
                .filter(entry => /^\d+$/.test(entry))
                .map(entry => parseInt(entry, 10))
                .filter(num => !isNaN(num));
            
            if (existingRunDirs.length > 0) {
                runNumber = Math.max(...existingRunDirs) + 1;
            }
        } catch (error) {
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
                        waitUntil: 'networkidle',
                        timeout: 30000 // Fixed Playwright timeout
                    });

                    // Race between networkidle and user-specified timeout
                    await Promise.race([
                        navigationPromise, 
                        new Promise((resolve) => setTimeout(resolve, options.timeout))
                    ]);
                    console.log(`- Navigation complete (either networkidle or ${options.timeout}ms timeout reached).`);
                } catch (error: any) {
                    if (error.name === 'TimeoutError') {
                        console.log(`- Playwright navigation timeout reached (30000ms). Continuing with screenshot.`);
                    } else {
                        throw error; // Rethrow other errors
                    }
                }
                
                // Process each resolution for the current URL without re-navigating
                for (const resolution of parsedResolutions) {
                    const {width, height} = resolution;
                    const resolutionString = `${width}x${height}`;
                    console.log(`\nProcessing resolution: ${resolutionString}`);
                    
                    // Set viewport for the current resolution
                    await page.setViewportSize({width, height});
                    
                    // Get sanitized path for the current URL
                    const url = new URL(normalizedUrl);
                    const sanitizedPath = sanitizePath(url.pathname);
                    
                    // Generate filename
                    const filename = `${resolutionString}-${sanitizedPath}.png`;
                    const outputPath = path.join(screenshotBaseDir, filename);
                    
                    // Take screenshot
                    console.log(`- Taking full page screenshot...`);
                    await page.screenshot({path: outputPath, fullPage: true});
                    console.log(`- Screenshot saved: ${outputPath}`);
                }
                
                // If crawling is enabled, extract and queue more URLs
                if (options.crawl) {
                    console.log(`- Extracting links from ${normalizedUrl}...`);
                    const links = await extractLinks(page, normalizedUrl);
                    console.log(`- Found ${links.length} links.`);
                    
                    // Add new links to pending queue if not already visited (normalize URLs)
                    for (const link of links) {
                        const normalizedLink = normalizeUrl(link);
                        if (!visitedUrls.has(normalizedLink)) {
                            pendingUrls.push(normalizedLink);
                        }
                    }
                    
                    console.log(`- Queue size: ${pendingUrls.length}, Visited: ${visitedUrls.size}`);
                }
            } catch (error: any) {
                console.error(`Error processing ${normalizedUrl}: ${error.message}`);
                console.error(`Skipping to next URL...`);
                // Continue with next URL instead of aborting everything
            }
        }
        
        if (options.crawl) {
            console.log(`\nCrawling complete. Processed ${visitedUrls.size} pages.`);
            if (pendingUrls.length > 0) {
                console.log(`Reached maximum page limit of ${options.maxPages}. ${pendingUrls.length} URLs not processed.`);
            }
        }

    } catch (error: any) {
        console.error("\n--- An Error Occurred ---");
        if (error instanceof Error) {
            console.error(`Error Message: ${error.message}`);
            if (error.stack) {
                console.error(`Stack Trace:\n${error.stack}`);
            }
        } else {
            console.error("Caught an unexpected error type:", error);
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
        parseResolution('390x844'),  // iPhone 12/13
        // parseResolution('360x640')   // Common Android
    ]
};

program
    .version('1.0.0')
    .description('CLI tool for taking website screenshots at various resolutions using Playwright, with optional website crawling functionality.')
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
    .option('-p, --max-pages <name>', 'Maximum number of pages to crawl (only used with --crawl)', (value) => {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed <= 0) {
            throw new Error('Max pages must be a positive number');
        }
        return parsed;
    }, 50) // Default to 50 pages max
    .option('-t, --timeout <ms>', 'Early screenshot timeout in milliseconds (defaults to 5000)', (value) => {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed <= 0) {
            throw new Error('Timeout must be a positive number in milliseconds');
        }
        return parsed;
    }, 5000)
    .action(async (url: string, options: { 
        resolution: Resolution[]; 
        output: string; 
        browser: SupportedBrowser;
        crawl: boolean;
        maxPages: number;
        desktop: boolean;
        mobile: boolean;
        timeout: number;
    }) => {
        // Handle device presets
        let resolutions = [...options.resolution]; // Start with custom resolutions
        
        if (options.desktop) {
            resolutions = [...resolutions, ...devicePresets.desktop];
        }
        
        if (options.mobile) {
            resolutions = [...resolutions, ...devicePresets.mobile];
        }
        
        // Remove duplicates (based on width and height)
        const uniqueResolutions = Array.from(
            new Map(resolutions.map(r => [`${r.width}x${r.height}`, r])).values()
        );
        
        // Map commander's options to our interface
        const mappedOptions: CliOptions = {
            resolutions: uniqueResolutions as unknown as string[],
            output: options.output,
            browser: options.browser,
            crawl: options.crawl,
            maxPages: options.maxPages,
            timeout: options.timeout
        };

        try {
            // Basic URL validation before passing to the main function
            new URL(url);
            await runScreenshotter(url, mappedOptions);
        } catch (error: any) {
            console.error(`\nError: ${error.message}`);
            if (error instanceof TypeError && error.message.includes('Invalid URL')) {
                console.error("Please provide a full URL including http:// or https://");
            }
            process.exit(1);
        }

    });

// Only parse args if the script is run directly
if (require.main === module) {
    program.parseAsync(process.argv).catch(err => {
        console.error("Failed to parse arguments or run command:", err);
        process.exit(1);
    });
}

// Export for potential programmatic use (optional)
export {runScreenshotter, CliOptions};

