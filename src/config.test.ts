import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {parseResolution} from './utils';
// The real merge implementation, so these tests exercise production code rather
// than a drifting copy.
import {mergeConfigWithOptions, GetOptionSource} from './index';

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
  // A fully-populated CLI options object at its default values. Individual
  // tests override fields and mark which ones the user "typed" via sources.
  const baseCli = () => ({
    resolution: [] as ReturnType<typeof parseResolution>[],
    output: '.',
    browser: 'chromium',
    crawl: false,
    maxPages: 50,
    timeout: 5000,
    navTimeout: 30000,
    concurrency: 3,
    retries: 2,
    excludePattern: [] as string[],
    includePattern: [] as string[],
    continueOnError: true,
    failFast: false,
    desktop: false,
    mobile: false,
    waitUntil: 'load',
    delay: 0,
    fullPage: true,
    headless: true,
  });

  // Build a source lookup where the named options came from the CLI and
  // everything else is at its default.
  const cliSources =
    (...cliNames: string[]): GetOptionSource =>
    (name) =>
      cliNames.includes(name) ? 'cli' : 'default';

  it('returns CLI options unchanged when there is no config file', () => {
    const cli = baseCli();
    expect(mergeConfigWithOptions(null, cli)).toBe(cli);
  });

  it('fills unset CLI options from the config file', () => {
    const result = mergeConfigWithOptions(
      {browser: 'webkit', maxPages: 30, timeout: 7000, output: './from-config'},
      baseCli(),
      cliSources() // user typed nothing
    );
    expect(result.browser).toBe('webkit');
    expect(result.maxPages).toBe(30);
    expect(result.timeout).toBe(7000);
    expect(result.output).toBe('./from-config');
  });

  it('lets an explicit CLI flag win over the config — even at a default-looking value', () => {
    const result = mergeConfigWithOptions(
      {timeout: 7000, browser: 'firefox'},
      {...baseCli(), timeout: 5000, browser: 'chromium'},
      cliSources('timeout', 'browser') // user explicitly passed both
    );
    // Previously the sentinel "=== 5000 means default" check let config win here.
    expect(result.timeout).toBe(5000);
    expect(result.browser).toBe('chromium');
  });

  it('honors config fullPage/headless/continueOnError when the user passed no flag', () => {
    const result = mergeConfigWithOptions(
      {fullPage: false, headless: false, continueOnError: false},
      baseCli(),
      cliSources()
    );
    // These were previously dead because the CLI always supplied a boolean.
    expect(result.fullPage).toBe(false);
    expect(result.headless).toBe(false);
    expect(result.continueOnError).toBe(false);
  });

  it('honors an explicit --no-full-page over a config fullPage:true', () => {
    const result = mergeConfigWithOptions(
      {fullPage: true},
      {...baseCli(), fullPage: false},
      cliSources('fullPage')
    );
    expect(result.fullPage).toBe(false);
  });

  it('forces continueOnError false when --fail-fast is set, regardless of config', () => {
    const result = mergeConfigWithOptions(
      {continueOnError: true},
      {...baseCli(), failFast: true},
      cliSources('failFast')
    );
    expect(result.continueOnError).toBe(false);
  });

  it('uses config resolutions when the user did not pass -r', () => {
    const result = mergeConfigWithOptions(
      {resolutions: ['800x600', '1366x768']},
      baseCli(),
      cliSources()
    );
    expect(result.resolution).toEqual([parseResolution('800x600'), parseResolution('1366x768')]);
  });

  it('uses CLI -r resolutions over config resolutions', () => {
    const result = mergeConfigWithOptions(
      {resolutions: ['800x600']},
      {...baseCli(), resolution: [parseResolution('1280x720')]},
      cliSources('resolution')
    );
    expect(result.resolution).toEqual([parseResolution('1280x720')]);
  });

  it('merges exclude and include patterns from both CLI and config', () => {
    const result = mergeConfigWithOptions(
      {excludePatterns: ['*/config-x/*'], includePatterns: ['*/config-i/*']},
      {...baseCli(), excludePattern: ['*/cli-x/*'], includePattern: ['*/cli-i/*']},
      cliSources('excludePattern', 'includePattern')
    );
    expect(result.excludePattern).toEqual(['*/cli-x/*', '*/config-x/*']);
    expect(result.includePattern).toEqual(['*/cli-i/*', '*/config-i/*']);
  });

  it('ignores an invalid waitUntil from config and keeps the CLI value', () => {
    const result = mergeConfigWithOptions(
      {waitUntil: 'not-a-state'},
      {...baseCli(), waitUntil: 'load'},
      cliSources()
    );
    expect(result.waitUntil).toBe('load');
  });
});
