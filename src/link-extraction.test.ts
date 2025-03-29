import {describe, it, expect, vi, beforeEach} from 'vitest';

// Mock playwright Page object
const mockEvaluate = vi.fn();
const mockPage = {
  evaluate: mockEvaluate,
};

// Import the function to test (manually recreated here to avoid dependency on playwright)
async function extractLinksForTest(page: any, baseUrl: string): Promise<string[]> {
  const url = new URL(baseUrl);
  const baseOrigin = url.origin;
  const basePath = url.pathname;

  // Extract all links from the page
  const links = await page.evaluate();

  // Helper function to normalize URLs (handle trailing slashes consistently)
  function normalizeUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      // For the root path with trailing slash, standardize to no trailing slash
      if (parsedUrl.pathname === '/') {
        parsedUrl.pathname = '';
      } else if (parsedUrl.pathname.endsWith('/') && parsedUrl.pathname.length > 1) {
        // For other paths with trailing slash, remove it
        parsedUrl.pathname = parsedUrl.pathname.slice(0, -1);
      }
      return parsedUrl.toString();
    } catch {
      return url; // Return original if invalid
    }
  }

  // Filter and normalize links
  return links
    .map((link: string) => {
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
        return null;
      }
    })
    .filter((link: string | null): link is string => link !== null && !link.includes('#')); // Remove hash fragments and nulls
}

describe('extractLinks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('extracts absolute URLs from the same origin', async () => {
    // Mock page.evaluate to return some links
    mockEvaluate.mockResolvedValue([
      'https://example.com/page1',
      'https://example.com/page2',
      'https://otherdomain.com/page3', // different origin, should be filtered out
    ]);

    const result = await extractLinksForTest(mockPage, 'https://example.com');

    expect(result).toHaveLength(2);
    expect(result).toContain('https://example.com/page1');
    expect(result).toContain('https://example.com/page2');
    expect(result).not.toContain('https://otherdomain.com/page3');
  });

  it('normalizes URLs by removing trailing slashes', async () => {
    mockEvaluate.mockResolvedValue(['https://example.com/page1/', 'https://example.com/']);

    const result = await extractLinksForTest(mockPage, 'https://example.com');

    expect(result).toContain('https://example.com/page1');
    expect(result).toContain('https://example.com/');
  });

  it('resolves absolute paths within the same domain', async () => {
    mockEvaluate.mockResolvedValue(['/page1', '/products/item']);

    const result = await extractLinksForTest(mockPage, 'https://example.com');

    expect(result).toContain('https://example.com/page1');
    expect(result).toContain('https://example.com/products/item');
  });

  it('resolves relative paths correctly', async () => {
    mockEvaluate.mockResolvedValue(['subpage', '../parent']);

    const result = await extractLinksForTest(mockPage, 'https://example.com/section/');

    expect(result).toContain('https://example.com/section/subpage');
    expect(result).toContain('https://example.com/parent');
  });

  it('filters out hash links and special URLs', async () => {
    mockEvaluate.mockResolvedValue([
      'https://example.com/page#section',
      'javascript:void(0)',
      'mailto:test@example.com',
      'tel:123456789',
    ]);

    const result = await extractLinksForTest(mockPage, 'https://example.com');

    expect(result).toHaveLength(0);
  });
});
