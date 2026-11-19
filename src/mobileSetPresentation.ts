import { localizeSetOrGrace } from './localization';

/** Omit the generic untranslated placeholder, retaining every known name and
 * leaving the underlying save/build record untouched. */
export function mobileSetLabel(value: string): string {
  const label = localizeSetOrGrace(value);
  return label === '未翻译套装' ? '' : label;
}
