/**
 * Filename / path sanitization for received files. A malicious sender controls the manifest,
 * so paths must be neutralized before they touch a filesystem: no traversal (`..`), no absolute
 * paths, no drive letters, no control or reserved characters.
 */

const ILLEGAL = /[<>:"|?*]/g;
const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Sanitizes a single path segment into a safe filename. Never returns an empty string. */
export function sanitizeFilename(name: string): string {
  let out = name.replace(/[\\/]/g, '_').replace(ILLEGAL, '_');
  out = Array.from(out)
    .filter((ch) => ch.charCodeAt(0) >= 0x20) // drop control characters
    .join('')
    .trim();
  out = out.replace(/^\.+/, ''); // no leading dots (hidden / traversal)
  out = out.replace(/[. ]+$/, ''); // no trailing dot/space (Windows)
  if (out.length === 0 || RESERVED_WINDOWS.test(out)) out = `file_${out}`;
  return out.slice(0, 255);
}

/**
 * Sanitizes a relative folder path from a manifest into safe segments, dropping any `.`/`..`
 * and rooting components. Returns a forward-slash path that can never escape the target dir.
 */
export function sanitizeRelativePath(path: string): string {
  const segments = path
    .split(/[\\/]/)
    .filter((s) => s.length > 0 && s !== '.' && s !== '..')
    .map(sanitizeFilename);
  return segments.length > 0 ? segments.join('/') : 'file';
}
