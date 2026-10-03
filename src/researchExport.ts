import { diffSnapshots } from "./diff";
import type { SaveSnapshot } from "./types";

export function createResearchDiff(current: SaveSnapshot, previous: SaveSnapshot) {
  return {
    schemaVersion: "1.0.0-research-diff",
    game: current.game,
    before: {
      snapshotId: previous.snapshotId,
      researchLabel: previous.researchLabel ?? null,
      dataSchemaVersion: previous.schemaVersion,
      parserVersion: previous.parserVersion ?? null,
    },
    after: {
      snapshotId: current.snapshotId,
      researchLabel: current.researchLabel ?? null,
      dataSchemaVersion: current.schemaVersion,
      parserVersion: current.parserVersion ?? null,
    },
    diff: diffSnapshots(current, previous),
    safety: {
      containsRawSave: false,
      sourceHashesIncluded: false,
    },
  };
}
