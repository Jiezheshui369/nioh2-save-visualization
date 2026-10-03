import { describe, expect, it } from "vitest";
import { isSourceNewer } from "./freshness";

describe("isSourceNewer", () => {
  it("detects a source written after the displayed snapshot", () => {
    expect(isSourceNewer("2026-09-19T18:10:00+10:00", "2026-09-19T18:01:17+10:00")).toBe(true);
  });

  it("tolerates timestamp precision and invalid legacy values", () => {
    expect(isSourceNewer("2026-09-19T18:01:17.800+10:00", "2026-09-19T18:01:17.100+10:00")).toBe(false);
    expect(isSourceNewer("未知", "2026-09-19T18:01:17+10:00")).toBe(false);
    expect(isSourceNewer(null, null)).toBe(false);
  });
});
