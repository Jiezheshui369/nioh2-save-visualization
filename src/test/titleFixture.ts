import catalog from '../titleDefinitions.json';
export function titleFixture(awardedIds: number[] = []) {
  const entries = catalog.definitions.map(d => ({ titleId: d.titleId, savedAwarded: awardedIds.includes(d.titleId) }));
  const group = (category: number) => {
    const rows = catalog.definitions.filter(d => d.category === category);
    const awarded = rows.filter(d => awardedIds.includes(d.titleId)).length;
    return { category, total: rows.length, awarded, notAwarded: rows.length-awarded, unknown: 0 };
  };
  return { version: 1, gameId: 'nioh2', definitionVersion: 'titles-v225', state: 'verified-saved-set', reason: null,
    entries, summary: { total: 390, awarded: awardedIds.length, notAwarded: 390-awardedIds.length, unknown: 0,
      groups: [group(0), group(1)] }, current: { completed: null, progress: null, visible: null, claimable: null } };
}
