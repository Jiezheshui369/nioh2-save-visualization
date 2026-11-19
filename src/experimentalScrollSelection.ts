import type { ExperimentalScrollSelection, SaveSnapshot, ScrollRecord } from "./types";
import { record, text } from "./dataValidation";
const uint32 = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;
export function isExperimentalScrollSelection(value: unknown): value is ExperimentalScrollSelection {
  if (!record(value) || value.formatVersion !== 1 || (value.status !== "unknown" && value.status !== "candidate")
    || value.selectorOffset !== "0x294070" || value.encodingHypothesis !== "uint32-le-table-index"
    || value.selectionVerified !== false || value.generalizationVerified !== false
    || !text(value.evidenceScope, 512)
    || !(value.rawSelector === null || uint32(value.rawSelector))) return false;
  if (value.status === "unknown") return value.candidateRecord === null && text(value.reason, 160);
  const candidate = value.candidateRecord;
  if (value.reason !== null || !record(candidate) || !uint32(candidate.recordIndex)
    || candidate.recordIndex >= 248 || candidate.recordIndex !== value.rawSelector
    || candidate.offset !== "0x" + (0x294080 + candidate.recordIndex * 0x88).toString(16)
    || typeof candidate.id !== "string" || !/^[0-9A-F]{4}$/.test(candidate.id)) return false;
  return true;
}
export function resolveExperimentalScroll(snapshot: SaveSnapshot): ScrollRecord | null {
  const meta = snapshot.experimentalScrollSelection;
  if (!isExperimentalScrollSelection(meta) || meta.status !== "candidate" || !meta.candidateRecord) return null;
  const ref = meta.candidateRecord;
  const rows = (snapshot.scrolls ?? []).filter(row => row.recordIndex === ref.recordIndex);
  return rows.length === 1 && rows[0].id.toUpperCase() === ref.id ? rows[0] : null;
}
