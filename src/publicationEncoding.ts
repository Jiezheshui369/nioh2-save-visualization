/** save-asset-value/1: deterministic hash bytes, NOT the JSON transport encoding.
 * Numbers use finite IEEE754 binary64 (negative zero normalized); unsafe integers
 * and unpaired surrogates are rejected rather than silently losing identity.
 */
export const PUBLICATION_ENCODING = 'save-asset-value/1' as const;
export function publicationBytes(value: unknown): Uint8Array {
  const utf8 = new TextEncoder();
  const string = (v: string): string => {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)) throw new Error('INVALID_PUBLICATION_STRING');
    return `s${utf8.encode(v).length}:${v}`;
  };
  const encode = (v: unknown, depth: number): string => {
    if (depth > 64) throw new Error('PUBLICATION_DEPTH');
    if (v === null) return 'n';
    if (typeof v === 'boolean') return v ? 't' : 'f';
    if (typeof v === 'string') return string(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || Number.isInteger(v) && !Number.isSafeInteger(v)) throw new Error('INVALID_PUBLICATION_NUMBER');
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setFloat64(0, v === 0 ? 0 : v, false);
      return 'd' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    if (Array.isArray(v)) return `a${v.length}:` + Array.from(v, item => encode(item, depth + 1)).join('');
    if (typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
      const row = v as Record<string, unknown>;
      const keys = Object.keys(row).filter(key => row[key] !== undefined).sort(); // UTF-16 code units.
      return `o${keys.length}:` + keys.map(key => string(key) + encode(row[key], depth + 1)).join('');
    }
    throw new Error('INVALID_PUBLICATION_VALUE');
  };
  return utf8.encode(PUBLICATION_ENCODING + '\n' + encode(value, 0));
}
