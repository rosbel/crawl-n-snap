import {describe, it, expect} from 'vitest';
import path from 'node:path';
import {isWithinRoot} from './dev-server';

const root = path.resolve('/srv/app');

describe('isWithinRoot', () => {
  it('accepts the root itself and paths inside it', () => {
    expect(isWithinRoot(root, root)).toBe(true);
    expect(isWithinRoot(root, path.join(root, 'shot.png'))).toBe(true);
    expect(isWithinRoot(root, path.join(root, 'a', 'b', 'c.png'))).toBe(true);
  });

  it('rejects a sibling directory that merely shares the prefix', () => {
    // The classic bug with `abs.startsWith(root)`: "/srv/app-secret" passes.
    expect(isWithinRoot(root, path.resolve('/srv/app-secret/file'))).toBe(false);
  });

  it('rejects parent and traversal paths', () => {
    expect(isWithinRoot(root, path.resolve('/srv'))).toBe(false);
    expect(isWithinRoot(root, path.join(root, '..', 'other.png'))).toBe(false);
    expect(isWithinRoot(root, path.resolve('/etc/passwd'))).toBe(false);
  });
});
