import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {parseResolution} from './utils';

// Mock fs module
vi.mock('fs/promises');
const mockedFs = vi.mocked(fs);

// Mock os module
vi.mock('os');
const mockedOs = vi.mocked(os);

// Recreate the config loading function for testing
interface ConfigFile {
  resolutions?: string[];
  output?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  crawl?: boolean;
  maxPages?: number;
  timeout?: number;
  concurrency?: number;
  retries?: number;
  continueOnError?: boolean;
  desktop?: boolean;
  mobile?: boolean;
  excludePatterns?: string[];
}

const supportedBrowsers: ('chromium' | 'firefox' | 'webkit')[] = ['chromium', 'firefox', 'webkit'];

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
    continueOnError: cliOptions.failFast
      ? false
      : (cliOptions.continueOnError ?? config.continueOnError ?? true),
    desktop: cliOptions.desktop || config.desktop || false,
    mobile: cliOptions.mobile || config.mobile || false,
  };
}

describe('Configuration File Loading', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedOs.homedir.mockReturnValue('/home/user');
    vi.spyOn(process, 'cwd').mockReturnValue('/current/dir');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no config file is found', async () => {
    mockedFs.readFile.mockRejectedValue({code: 'ENOENT'});

    const result = await loadConfigFile();
    expect(result).toBeNull();

    // Should check both filenames in both directories
    expect(mockedFs.readFile).toHaveBeenCalledTimes(4);
    expect(mockedFs.readFile).toHaveBeenCalledWith('/current/dir/.crawlsnaprc.json', 'utf8');
    expect(mockedFs.readFile).toHaveBeenCalledWith('/current/dir/.crawlsnaprc', 'utf8');
    expect(mockedFs.readFile).toHaveBeenCalledWith('/home/user/.crawlsnaprc.json', 'utf8');
    expect(mockedFs.readFile).toHaveBeenCalledWith('/home/user/.crawlsnaprc', 'utf8');
  });

  it('loads and parses valid config file from current directory', async () => {
    const configData = {
      resolutions: ['1920x1080', '390x844'],
      browser: 'firefox',
      output: './screenshots',
      crawl: true,
      maxPages: 100,
    };

    mockedFs.readFile
      .mockResolvedValueOnce(JSON.stringify(configData))
      .mockRejectedValue({code: 'ENOENT'});

    const result = await loadConfigFile();
    expect(result).toEqual(configData);
    expect(console.log).toHaveBeenCalledWith(
      'Using configuration from: /current/dir/.crawlsnaprc.json'
    );
  });

  it('loads config from home directory if not found in current directory', async () => {
    const configData = {
      browser: 'webkit',
      concurrency: 5,
    };

    mockedFs.readFile
      .mockRejectedValueOnce({code: 'ENOENT'}) // .crawlsnaprc.json in current dir
      .mockRejectedValueOnce({code: 'ENOENT'}) // .crawlsnaprc in current dir
      .mockResolvedValueOnce(JSON.stringify(configData)); // .crawlsnaprc.json in home dir

    const result = await loadConfigFile();
    expect(result).toEqual(configData);
    expect(console.log).toHaveBeenCalledWith(
      'Using configuration from: /home/user/.crawlsnaprc.json'
    );
  });

  it('handles invalid JSON gracefully', async () => {
    mockedFs.readFile.mockResolvedValueOnce('{ invalid json }').mockRejectedValue({code: 'ENOENT'});

    const result = await loadConfigFile();
    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Warning: Could not parse config file /current/dir/.crawlsnaprc.json:'
      )
    );
  });

  it('validates and removes invalid browser option', async () => {
    const configData = {
      browser: 'invalid-browser',
      output: './screenshots',
    };

    mockedFs.readFile
      .mockResolvedValueOnce(JSON.stringify(configData))
      .mockRejectedValue({code: 'ENOENT'});

    const result = await loadConfigFile();
    expect(result).toEqual({output: './screenshots'});
    expect(console.warn).toHaveBeenCalledWith(
      'Invalid browser "invalid-browser" in /current/dir/.crawlsnaprc.json. Using default.'
    );
  });
});

describe('Configuration Merging', () => {
  it('uses CLI options when no config file is provided', () => {
    const cliOptions = {
      resolution: [parseResolution('800x600')],
      output: './custom',
      browser: 'firefox',
      crawl: true,
      maxPages: 20,
      timeout: 3000,
      concurrency: 2,
      retries: 1,
      continueOnError: false,
      excludePattern: ['*/admin/*'],
      desktop: false,
      mobile: true,
      failFast: false,
    };

    const result = mergeConfigWithOptions(null, cliOptions);
    expect(result).toEqual({
      ...cliOptions,
      excludePattern: ['*/admin/*'],
    });
  });

  it('merges config file with CLI options (CLI takes precedence)', () => {
    const config: ConfigFile = {
      resolutions: ['1366x768', '390x844'],
      browser: 'webkit',
      output: './config-output',
      crawl: false,
      maxPages: 30,
      timeout: 7000,
      concurrency: 4,
      retries: 3,
      continueOnError: false,
      excludePatterns: ['*/config-exclude/*'],
    };

    const cliOptions = {
      resolution: [parseResolution('800x600')], // Custom resolution - should override config
      output: './cli-output', // Non-default - should override config
      browser: 'chromium', // Default value - should use config
      crawl: true, // Explicit true - should override config false
      maxPages: 50, // Default value - should use config
      timeout: 5000, // Default value - should use config
      concurrency: 3, // Default value - should use config
      retries: 2, // Default value - should use config
      continueOnError: undefined, // Default value - should use config
      excludePattern: ['*/cli-exclude/*'],
      desktop: false,
      mobile: false,
      failFast: false,
    };

    const result = mergeConfigWithOptions(config, cliOptions);

    expect(result.resolution).toEqual([parseResolution('800x600')]);
    expect(result.output).toBe('./cli-output');
    expect(result.browser).toBe('webkit'); // From config
    expect(result.crawl).toBe(true); // From CLI (explicit true)
    expect(result.maxPages).toBe(30); // From config (CLI has default)
    expect(result.timeout).toBe(7000); // From config (CLI has default)
    expect(result.concurrency).toBe(4); // From config (CLI has default)
    expect(result.retries).toBe(3); // From config (CLI has default)
    expect(result.continueOnError).toBe(false); // From config (CLI has undefined/default)
    expect(result.excludePattern).toEqual(['*/cli-exclude/*', '*/config-exclude/*']); // Merged
  });

  it('handles failFast option correctly', () => {
    const config: ConfigFile = {
      continueOnError: true,
    };

    const cliOptionsWithFailFast = {
      resolution: [parseResolution('1920x1080')],
      output: '.',
      browser: 'chromium',
      crawl: false,
      maxPages: 50,
      timeout: 5000,
      concurrency: 3,
      retries: 2,
      continueOnError: true,
      excludePattern: [],
      desktop: false,
      mobile: false,
      failFast: true, // This should override continueOnError to false
    };

    const result = mergeConfigWithOptions(config, cliOptionsWithFailFast);
    expect(result.continueOnError).toBe(false);
  });

  it('uses config resolutions when CLI has default resolution', () => {
    const config: ConfigFile = {
      resolutions: ['800x600', '1366x768'],
    };

    const cliOptionsWithDefault = {
      resolution: [parseResolution('1920x1080')], // Default resolution
      output: '.',
      browser: 'chromium',
      crawl: false,
      maxPages: 50,
      timeout: 5000,
      concurrency: 3,
      retries: 2,
      continueOnError: true,
      excludePattern: [],
      desktop: false,
      mobile: false,
      failFast: false,
    };

    const result = mergeConfigWithOptions(config, cliOptionsWithDefault);
    expect(result.resolution).toEqual([parseResolution('800x600'), parseResolution('1366x768')]);
  });
});
