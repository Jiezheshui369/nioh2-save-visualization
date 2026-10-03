import { describe, expect, it } from 'vitest';
import { effectText, effectValueText, hasVerifiedEffectValue } from './effectValues';
import type { EffectValueDetail } from './types';

describe('effect evidence presentation', () => {
  it('requires the known numeric unit and raw value to agree before counting or displaying verification', () => {
    for (const [id, rawValue, magnitude] of [['B4D8', 21, '2.1%'], ['9BF2', 33, '33'],
      ['9158', 0xFFFFFFFF, '429497000%'], ['91A6', 19, '20']] as const) {
      const item = { effectIds: [id], effectMagnitudes: [magnitude],
        effectValueDetails: [{ rawValue, kind: 'numeric', encoding: 'verified-id' } as const] };
      expect(hasVerifiedEffectValue(item, 0)).toBe(false);
      expect(effectValueText(item, 0)).toBe('数值未解析');
      expect(item.effectMagnitudes).toEqual([magnitude]);
    }
    const maximum = { effectIds: ['9158'], effectMagnitudes: ['429496729.5%'],
      effectValueDetails: [{ rawValue: 0xFFFFFFFF, kind: 'numeric', encoding: 'verified-id' } as const] };
    expect(hasVerifiedEffectValue(maximum, 0)).toBe(true);
    expect(effectValueText(maximum, 0)).toBe('429496729.5%');
  });
  it('counts only explicit verified encodings, including zero', () => {
    const detail: EffectValueDetail = { rawValue: 0, kind: 'numeric', encoding: 'verified-id' };
    expect(hasVerifiedEffectValue({ effectIds: ['91A6'], effectMagnitudes: ['0'], effectValueDetails: [detail] }, 0)).toBe(true);
    expect(hasVerifiedEffectValue({ effectIds: ['DAC2'], effectMagnitudes: ['150'], effectValueDetails: [detail] }, 0)).toBe(false);
    expect(hasVerifiedEffectValue({ effectIds: ['91A6'], effectMagnitudes: ['1.9'] }, 0)).toBe(false);
    expect(hasVerifiedEffectValue({ effectIds: ['91A6'], effectMagnitudes: ['1.9'], effectValueDetails: [{ ...detail, encoding: 'legacy-cap' }] }, 0)).toBe(false);
  });
  it('corrects old Ultimate values without changing the archive', () => {
    const item = { effects: ['Ultimate Constitution'], effectsZh: ['体之深奥'], effectIds: ['dac2'], effectMagnitudes: ['150'] };
    expect(effectText(item, 0)).toBe('体之深奥 条件词条（非数值加成）');
    expect(item.effectMagnitudes).toEqual(['150']);
  });
  it('does not show an unverified Anima percentage from old archives', () => {
    expect(effectValueText({ effectIds: ['5CFF'], effectMagnitudes: ['0.9%'] }, 0)).toBe('单位未解析');
  });
  it.each([['B4D8', 21, '2.1'], ['5B76', 16, '1.6'], ['5CFF', 15, '1.5']] as const)('shows freshly decoded decimal Anima for %s', (id, raw, value) => {
    const item = { effectIds: [id], effectMagnitudes: [value], effectValueDetails: [{ rawValue: raw, kind: 'numeric', encoding: 'verified-id' } as const] };
    expect(effectValueText(item, 0)).toBe(value);
    expect(hasVerifiedEffectValue(item, 0)).toBe(true);
    expect(effectValueText({ ...item, effectValueDetails: [{ rawValue: raw, kind: 'numeric', encoding: 'legacy-cap' }] }, 0)).toBe('单位未解析');
    expect(effectValueText({ ...item, effectValueDetails: [{ rawValue: raw, kind: 'unverified-unit', encoding: 'not-decoded' }] }, 0)).toBe('单位未解析');
    expect(item.effectMagnitudes).toEqual([value]);
  });
  it.each([
    ['condition', '条件词条（非数值加成）'], ['non-numeric', '非数值词条'],
    ['unresolved-grade', '档位未解析'], ['unverified-unit', '单位未解析'], ['unknown', '数值未解析'],
  ] as const)('distinguishes %s without asserting activation', (kind, expected) => {
    expect(effectValueText({ effectMagnitudes: ['150'], effectValueDetails: [{ rawValue: 150, kind, encoding: 'not-decoded' }] }, 0)).toBe(expected);
  });
  it.each([['3961', 13, 'AA'], ['9ad2', 13, 'AA'], ['24E8', 8, 'B+']] as const)('only displays the verified grade pair for %s', (id, rawValue, grade) => {
    const item = { effectIds: [id], effectMagnitudes: [grade],
      effectValueDetails: [{ rawValue, kind: 'grade', encoding: 'verified-id' } as const] };
    expect(effectValueText(item, 0)).toBe(grade);
    expect(hasVerifiedEffectValue(item, 0)).toBe(true);
    for (const invalid of [
      { ...item, effectMagnitudes: ['AAA+'] },
      { ...item, effectIds: ['C0C9'] },
      { ...item, effectValueDetails: undefined },
      { ...item, effectValueDetails: [{ rawValue: rawValue + 1, kind: 'grade', encoding: 'verified-id' } as const] },
      { ...item, effectValueDetails: [{ rawValue, kind: 'unresolved-grade', encoding: 'not-decoded' } as const] },
      { ...item, effectValueDetails: [{ rawValue, kind: 'numeric', encoding: 'legacy-cap' } as const] },
    ]) {
      expect(effectValueText(invalid, 0)).toBe('档位未解析');
      expect(hasVerifiedEffectValue(invalid, 0)).toBe(false);
    }
    expect(item.effectMagnitudes).toEqual([grade]);
  });
  it('keeps zero, verified units and legacy uncertainty distinct', () => {
    const details: EffectValueDetail[] = [
      { rawValue: 0, kind: 'numeric', encoding: 'verified-id' },
      { rawValue: 10, kind: 'numeric', encoding: 'legacy-cap' },
    ];
    const item = { effectMagnitudes: ['0', '1%'], effectValueDetails: details };
    expect(effectValueText(item, 0)).toBe('0');
    expect(effectValueText(item, 1)).toBe('1%（单位待复核）');
    expect(effectValueText({}, 0)).toBe('数值未解析');
  });
});
