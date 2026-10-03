import rules from '../agent/data/effect_value_rules.json';
import type { EquipmentItem, ScrollRecord } from './types';
import { localizeEffect } from './localization';

type EffectRecord = Pick<EquipmentItem | ScrollRecord, 'effects' | 'effectsZh' | 'effectIds' | 'effectMagnitudes' | 'effectValueDetails'>;
const gradeValues: Record<string, Record<string, string>> = rules.verifiedGradeValues;
const numericIds = new Set([...rules.verifiedDecimalIds, ...rules.verifiedPercentIds]);

function verifiedNumber(item: EffectRecord, index: number): string | undefined {
  const detail = item.effectValueDetails?.[index];
  const id = item.effectIds?.[index]?.toUpperCase() ?? '';
  if (detail?.kind !== 'numeric' || detail.encoding !== 'verified-id' || !numericIds.has(id)) return undefined;
  const raw = detail.rawValue;
  if (!Number.isInteger(raw) || raw < 0 || raw > 0xFFFFFFFF) return undefined;
  const fraction = raw % 10;
  const value = `${Math.floor(raw / 10)}${fraction ? `.${fraction}` : ''}${rules.verifiedPercentIds.includes(id) ? '%' : ''}`;
  return item.effectMagnitudes?.[index] === value ? value : undefined;
}

function verifiedGrade(item: EffectRecord, index: number): string | undefined {
  const detail = item.effectValueDetails?.[index];
  const id = item.effectIds?.[index]?.toUpperCase() ?? '';
  if (detail?.kind !== 'grade' || detail.encoding !== 'verified-id') return undefined;
  const grade = gradeValues[id]?.[String(detail.rawValue)];
  return grade && item.effectMagnitudes?.[index] === grade ? grade : undefined;
}

export function hasVerifiedEffectValue(item: EffectRecord, index: number): boolean {
  const detail = item.effectValueDetails?.[index];
  if (detail?.kind === 'grade') return Boolean(verifiedGrade(item, index));
  return verifiedNumber(item, index) !== undefined;
}

// Also correct legacy archives at presentation time; never rewrite imported data.
export function effectValueText(item: EffectRecord, index: number): string {
  const id = item.effectIds?.[index]?.toUpperCase() ?? '';
  const detail = item.effectValueDetails?.[index];
  if (rules.conditionIds.includes(id) || detail?.kind === 'condition') return '条件词条（非数值加成）';
  if (rules.unverifiedUnitIds.includes(id) || detail?.kind === 'unverified-unit') return '单位未解析';
  // Require this ID + raw-value pair and fresh metadata. Never upgrade an old
  // CAP-based label or infer a neighboring grade from a single observed point.
  if (Object.hasOwn(gradeValues, id) || detail?.kind === 'grade') return verifiedGrade(item, index) ?? '档位未解析';
  // Old archives may contain a CAP-guessed percentage for these newly decoded
  // Anima IDs. Require a fresh, explicit numeric encoding before displaying it.
  if (rules.verifiedAnimaIds.includes(id) && !(detail?.kind === 'numeric' && detail.encoding === 'verified-id')) return '单位未解析';
  if (detail?.kind === 'non-numeric') return '非数值词条';
  if (detail?.kind === 'unresolved-grade') return '档位未解析';
  if (detail && (detail.kind === 'unknown' || detail.encoding === 'not-decoded')) return '数值未解析';
  if (detail?.kind === 'numeric' && detail.encoding === 'verified-id' && numericIds.has(id)
      && verifiedNumber(item, index) === undefined) return '数值未解析';
  const magnitude = item.effectMagnitudes?.[index];
  if (magnitude === undefined || magnitude === null || magnitude === '') return '数值未解析';
  return detail?.encoding === 'legacy-cap' ? `${magnitude}（单位待复核）` : magnitude;
}

export function effectText(item: EffectRecord, index: number): string {
  return `${localizeEffect(item.effects?.[index] ?? '', item.effectsZh?.[index])} ${effectValueText(item, index)}`;
}
