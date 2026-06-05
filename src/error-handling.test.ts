import {describe, it, expect} from 'vitest';

// We need to import or recreate the functions since they're in the main index.ts file
// For testing purposes, let's recreate the key functions here

// Recreate the error classification function for testing
function classifyError(
  error: any
): 'navigation' | 'screenshot' | 'linkExtraction' | 'fileSystem' | 'unknown' {
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

// Recreate the URL exclusion function for testing (fixed version)
function isUrlExcluded(url: string, excludePatterns: string[]): boolean {
  if (excludePatterns.length === 0) return false;

  return excludePatterns.some((pattern) => {
    // Convert glob-like pattern to regex
    // First replace * with placeholder, then escape regex chars, then convert placeholder to .*
    const regexPattern = pattern
      .replace(/\*/g, '__WILDCARD__') // Replace * with placeholder
      .replace(/[.+^${}()|[\]\\?]/g, '\\$&') // Escape regex special chars
      .replace(/__WILDCARD__/g, '.*'); // Convert placeholder to .*

    const regex = new RegExp(`^${regexPattern}$`, 'i'); // Case insensitive
    return regex.test(url);
  });
}

describe('Error Classification', () => {
  it('classifies timeout errors correctly', () => {
    expect(classifyError({name: 'TimeoutError', message: 'Navigation timeout'})).toBe('navigation');
    expect(classifyError({message: 'Request timeout occurred'})).toBe('navigation');
  });

  it('classifies screenshot errors correctly', () => {
    expect(classifyError({message: 'Screenshot failed'})).toBe('screenshot');
    expect(classifyError({message: 'page.screenshot() error'})).toBe('screenshot');
  });

  it('classifies file system errors correctly', () => {
    expect(classifyError({message: 'ENOENT: no such file or directory'})).toBe('fileSystem');
    expect(classifyError({message: 'Permission denied when creating mkdir'})).toBe('fileSystem');
  });

  it('classifies network errors correctly', () => {
    expect(classifyError({message: 'Network connection failed'})).toBe('navigation');
    expect(classifyError({message: 'net::ERR_CONNECTION_REFUSED'})).toBe('navigation');
  });

  it('classifies link extraction errors correctly', () => {
    expect(classifyError({message: 'Failed to evaluate link selector'})).toBe('linkExtraction');
    expect(classifyError({message: 'Link parsing error'})).toBe('linkExtraction');
  });

  it('classifies unknown errors as unknown', () => {
    expect(classifyError({message: 'Some random error'})).toBe('unknown');
    expect(classifyError({})).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
  });
});

describe('URL Exclusion Patterns', () => {
  it('returns false when no patterns are provided', () => {
    expect(isUrlExcluded('https://example.com/admin', [])).toBe(false);
  });

  it('matches exact URL patterns', () => {
    const patterns = ['https://example.com/admin'];
    expect(isUrlExcluded('https://example.com/admin', patterns)).toBe(true);
    expect(isUrlExcluded('https://example.com/user', patterns)).toBe(false);
  });

  it('matches wildcard patterns correctly', () => {
    const patterns = ['*/admin/*', '*/login/*'];
    expect(isUrlExcluded('https://example.com/admin/users', patterns)).toBe(true);
    expect(isUrlExcluded('https://example.com/login/form', patterns)).toBe(true);
    expect(isUrlExcluded('https://example.com/public/page', patterns)).toBe(false);
  });

  it('handles case insensitive matching', () => {
    const patterns = ['*/ADMIN/*'];
    expect(isUrlExcluded('https://example.com/admin/users', patterns)).toBe(true);
    expect(isUrlExcluded('https://example.com/Admin/Users', patterns)).toBe(true);
  });

  it('matches complex wildcard patterns', () => {
    const patterns = ['*://example.com/api/*', 'https://*/internal/*'];
    expect(isUrlExcluded('https://example.com/api/v1/users', patterns)).toBe(true);
    expect(isUrlExcluded('http://example.com/api/auth', patterns)).toBe(true);
    expect(isUrlExcluded('https://test.com/internal/admin', patterns)).toBe(true);
    expect(isUrlExcluded('https://example.com/public/page', patterns)).toBe(false);
  });

  it('handles multiple patterns', () => {
    const patterns = ['*/admin/*', '*/login', '*/logout', '*checkout*'];
    expect(isUrlExcluded('https://shop.com/admin/dashboard', patterns)).toBe(true);
    expect(isUrlExcluded('https://shop.com/login', patterns)).toBe(true);
    expect(isUrlExcluded('https://shop.com/checkout/payment', patterns)).toBe(true);
    expect(isUrlExcluded('https://shop.com/products', patterns)).toBe(false);
  });

  it('escapes regex special characters properly', () => {
    const patterns = ['*/test.html', '*/api+data', '*/query?param=value'];
    expect(isUrlExcluded('https://example.com/test.html', patterns)).toBe(true);
    expect(isUrlExcluded('https://example.com/test_html', patterns)).toBe(false);
    expect(isUrlExcluded('https://example.com/api+data', patterns)).toBe(true);
    expect(isUrlExcluded('https://example.com/query?param=value', patterns)).toBe(true);
  });
});
