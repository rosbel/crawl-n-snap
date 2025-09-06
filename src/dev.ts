// Interactive Dev UI (terminal) for working on crawl-n-snap without extra deps.

import readline from 'node:readline';
import {runScreenshotter, CliOptions} from './index';

function createRl() {
  return readline.createInterface({input: process.stdin, output: process.stdout});
}

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((res) => rl.question(q, (a) => res(a.trim())));
}

function parseBool(input: string, def: boolean): boolean {
  if (!input) return def;
  const v = input.toLowerCase();
  return v === 'y' || v === 'yes' || v === 'true' || v === '1';
}

function parseNumber(input: string, def: number): number {
  if (!input) return def;
  const n = parseInt(input, 10);
  return Number.isFinite(n) ? n : def;
}

async function main() {
  const rl = createRl();

  console.log('Crawl-n-Snap Dev UI');
  console.log('Press Enter to accept defaults. Values can be comma-separated where noted.');
  console.log('---');

  const url = (await ask(rl, 'URL [https://example.com]: ')) || 'https://example.com';

  const resInput = await ask(rl, 'Resolutions (comma-separated) [1920x1080]: ');
  const resolutions = (resInput || '1920x1080')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const useDesktop = parseBool(await ask(rl, 'Include desktop preset 1920x1080? [Y/n]: '), true);
  const useMobile = parseBool(await ask(rl, 'Include mobile preset 390x844? [y/N]: '), false);
  if (useDesktop && !resolutions.includes('1920x1080')) resolutions.push('1920x1080');
  if (useMobile && !resolutions.includes('390x844')) resolutions.push('390x844');

  const browser = (await ask(rl, 'Browser (chromium|firefox|webkit) [chromium]: ')) || 'chromium';
  const output = (await ask(rl, 'Output directory [./dev-screenshots]: ')) || './dev-screenshots';

  const crawl = parseBool(await ask(rl, 'Crawl links? [y/N]: '), false);
  const maxPages = parseNumber(await ask(rl, 'Max pages (crawl only) [50]: '), 50);

  const timeout = parseNumber(await ask(rl, 'Early screenshot timeout ms [5000]: '), 5000);
  const concurrency = parseNumber(await ask(rl, 'Concurrency [3]: '), 3);
  const retries = parseNumber(await ask(rl, 'Retry attempts [2]: '), 2);

  const includeInput = await ask(rl, 'Include patterns (comma) []: ');
  const includePatterns = includeInput
    ? includeInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const excludeInput = await ask(rl, 'Exclude patterns (comma) []: ');
  const excludePatterns = excludeInput
    ? excludeInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const waitUntil =
    (await ask(rl, 'waitUntil (load|domcontentloaded|networkidle|commit) [networkidle]: ')) ||
    'networkidle';
  const delay = parseNumber(await ask(rl, 'Delay before screenshot ms [0]: '), 0);
  const fullPage = parseBool(await ask(rl, 'Full page screenshot? [Y/n]: '), true);
  const headless = !parseBool(await ask(rl, 'Headful (show browser UI)? [y/N]: '), false);

  const failFast = parseBool(await ask(rl, 'Fail fast? [y/N]: '), false);
  const continueOnError = failFast
    ? false
    : parseBool(await ask(rl, 'Continue on error? [Y/n]: '), true);

  console.log('\nSummary:');
  console.log({
    url,
    resolutions,
    browser,
    output,
    crawl,
    maxPages,
    timeout,
    concurrency,
    retries,
    includePatterns,
    excludePatterns,
    waitUntil,
    delay,
    fullPage,
    headless,
    continueOnError,
    failFast,
  });

  const proceed = parseBool(await ask(rl, '\nStart run? [Y/n]: '), true);
  if (!proceed) {
    rl.close();
    console.log('Aborted.');
    return;
  }

  rl.close();

  const options: CliOptions = {
    resolutions,
    output,
    browser: browser as any,
    crawl,
    maxPages,
    timeout,
    concurrency,
    retries,
    includePatterns,
    excludePatterns,
    continueOnError,
    waitUntil: waitUntil as any,
    delay,
    fullPage,
    headless,
  };

  await runScreenshotter(url, options);
}

main().catch((err) => {
  console.error('Dev UI failed:', err);
  process.exit(1);
});
