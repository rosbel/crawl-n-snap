import { describe, it, expect } from 'vitest';
import { parseResolution, sanitizePath, normalizeUrl } from './utils';

describe('parseResolution', () => {
    it('parses valid resolution strings', () => {
        expect(parseResolution('1920x1080')).toEqual({ width: 1920, height: 1080 });
        expect(parseResolution('800x600')).toEqual({ width: 800, height: 600 });
        expect(parseResolution('320x240')).toEqual({ width: 320, height: 240 });
    });

    it('throws error for invalid resolution format', () => {
        expect(() => parseResolution('1920')).toThrow('Invalid resolution format');
        expect(() => parseResolution('1920x')).toThrow('Invalid resolution format');
        expect(() => parseResolution('x1080')).toThrow('Invalid resolution format');
        expect(() => parseResolution('1920-1080')).toThrow('Invalid resolution format');
    });

    it('throws error for invalid dimensions', () => {
        expect(() => parseResolution('0x1080')).toThrow('Invalid resolution dimensions');
        expect(() => parseResolution('1920x0')).toThrow('Invalid resolution dimensions');
        expect(() => parseResolution('-1920x1080')).toThrow('Invalid resolution dimensions');
        expect(() => parseResolution('1920x-1080')).toThrow('Invalid resolution dimensions');
        expect(() => parseResolution('abcx1080')).toThrow('Invalid resolution dimensions');
        expect(() => parseResolution('1920xabc')).toThrow('Invalid resolution dimensions');
    });
});

describe('sanitizePath', () => {
    it('sanitizes simple paths', () => {
        expect(sanitizePath('/about')).toBe('about');
        expect(sanitizePath('/about/')).toBe('about');
        expect(sanitizePath('/about/us')).toBe('about-us');
    });

    it('handles special characters', () => {
        expect(sanitizePath('/product?id=123')).toBe('product_id_123');
        expect(sanitizePath('/search?q=term&page=2')).toBe('search_q_term_page_2');
    });

    it('handles root path', () => {
        expect(sanitizePath('/')).toBe('root');
        expect(sanitizePath('')).toBe('root');
    });
});

describe('normalizeUrl', () => {
    it('removes trailing slashes from paths', () => {
        expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
        expect(normalizeUrl('https://example.com/about/')).toBe('https://example.com/about');
    });

    it('preserves URLs without trailing slashes', () => {
        expect(normalizeUrl('https://example.com/about')).toBe('https://example.com/about');
    });

    it('preserves query parameters', () => {
        expect(normalizeUrl('https://example.com/search?q=test')).toBe('https://example.com/search?q=test');
    });

    it('returns original for invalid URLs', () => {
        expect(normalizeUrl('invalid-url')).toBe('invalid-url');
    });
});