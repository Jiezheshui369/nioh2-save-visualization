import { isResearchStatus } from "./researchStatus";
import { isExperimentalScrollSelection } from "./experimentalScrollSelection";
import type { SaveSnapshot } from './types';
import { isCharacterStatus } from './characterStatus';
import { isTitles } from './titles';
import { isSkills } from './skills';
import { attributes, backupComparison, finite, numericMap, optional, record, snapshotDetails, text } from './dataValidation';

// Shared by import, network and persistent cache; no API/storage dependency cycle.
export function isSupportedSnapshot(value: unknown): value is SaveSnapshot {
  if (!record(value) || !text(value.schemaVersion, 80) || !text(value.snapshotId, 160)) return false;
  if (!optional(value.localPublication, p => record(p) && p.version === 1 && p.status === 'ready-local'
    && typeof p.publicationVersion === 'number' && Number.isSafeInteger(p.publicationVersion) && p.publicationVersion > 0
    && p.snapshotId === value.snapshotId && typeof p.revision === 'string' && /^[a-f0-9]{64}$/.test(p.revision)
    && typeof p.preparedAtUtc === 'string' && p.preparedAtUtc.length <= 80 && Number.isFinite(Date.parse(p.preparedAtUtc))
    && optional(p.remotePublication, r => record(r) && Object.keys(r).length === 2 && r.status === 'not-ready' && r.reason === 'UNSAFE_INTEGER'))) return false;
  if (!snapshotDetails(value)) return false;
  if (!optional(value.experimentalScrollSelection, isExperimentalScrollSelection)) return false;
  if (!['game', 'platform', 'parserVersion', 'researchLabel', 'loadoutSource'].every(key => optional(value[key], v => text(v, 1024)))) return false;
  if (!optional(value.backupComparison, backupComparison)) return false;
  if (!optional(value.privacy, v => record(v) && typeof v.redactedForSharing === 'boolean')) return false;
  if (value.researchStatus !== undefined && !isResearchStatus(value.researchStatus)) return false;
  if (value.characterStatus !== undefined && !isCharacterStatus(value.characterStatus)) return false;
  if (value.titles !== undefined && (value.game !== 'Nioh 2 - The Complete Edition' || !isTitles(value.titles))) return false;
  if (value.skills !== undefined && (value.game !== 'Nioh 2 - The Complete Edition' || !isSkills(value.skills))) return false;
  if (!text(value.sourceLastWriteLocal, 80)) return false;
  const character = value.character;
  const summary = value.inventorySummary;
  const safety = value.safety;
  if (!record(character) || !finite(character.level) || !finite(character.amrita) || !finite(character.gold)) return false;
  if (!attributes(character.attributes) || !numericMap(character.proficiency)) return false;
  if (!optional(character.skillPointCounters, v => record(v) && Object.keys(v).length <= 256
    && Object.entries(v).every(([key, item]) => text(key, 160) && record(item) && finite(item.temporary) && finite(item.permanent)))) return false;
  if (!record(summary) || !finite(summary.equipmentRecords) || !finite(summary.stackedItemRecords)
    || !finite(summary.scrollRecordsDetected) || !numericMap(summary.equipmentByType)
    || !optional(summary.equipmentUnknownIds, finite)) return false;
  if (!record(safety) || safety.sourceOpenedReadOnly !== true || safety.parsedFromCopy !== true
    || safety.originalHashUnchangedAfterProcessing !== true) return false;
  if (value.skills !== undefined && isSkills(value.skills) &&
    (typeof safety.snapshotCopySha256 !== 'string' || value.skills.inputSha256.toUpperCase() !== safety.snapshotCopySha256.toUpperCase())) return false;
  return text(safety.originalMainSaveSha256, 160) && optional(safety.snapshotCopySha256, v => text(v, 160));
}
