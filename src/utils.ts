// src/utils.ts
import {URL} from 'url';

export interface Resolution {
    width: number;
    height: number;
}

export function parseResolution(value: string): Resolution {
    const parts = value.toLowerCase().split('x');
    if (parts.length !== 2) {
        throw new Error(`Invalid resolution format: "${value}". Use WxH (e.g., 1920x1080).`);
    }
    const width = parseInt(parts[0], 10);
    const height = parseInt(parts[1], 10);
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
        throw new Error(`Invalid resolution dimensions: "${value}". Width and height must be positive numbers.`);
    }
    return {width, height};
}

export function collectResolutions(value: string, previous: Resolution[]): Resolution[] {
    try {
        const newRes = parseResolution(value);
        return previous.concat([newRes]);
    } catch (error: any) {
        console.error(`Error parsing resolution "${value}": ${error.message}`);
        process.exit(1); // Exit if resolution is invalid
    }
}

export function getCurrentDateTimeString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export function sanitizePath(pathname: string): string {
    // Remove leading/trailing slashes and replace other slashes with hyphens
    return pathname
            .replace(/^\/|\/$/g, '') // Remove leading/trailing slashes
            .replace(/\//g, '-')     // Replace inner slashes with hyphens
            .replace(/[^a-zA-Z0-9\-]/g, '_') // Replace non-alphanumeric/hyphen chars with underscore
        || 'root'; // Use 'root' if path is empty after sanitization (e.g., homepage "/")
}

export function normalizeUrl(url: string): string {
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
    } catch (error) {
        return url; // Return original if invalid
    }
}