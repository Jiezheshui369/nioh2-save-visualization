import { describe, it, expect } from 'vitest';
import cases from '../scripts/ios-tests/pairing-cases.json';
import { parsePairingQr } from './pairing';

describe('shared Android/iOS pairing boundary', () => {
  it.each(cases)('$name', ({ qr, valid }) => {
    if (valid) expect(parsePairingQr(qr).port).toBe(13354);
    else expect(() => parsePairingQr(qr)).toThrow('配对信息无效');
  });
});
