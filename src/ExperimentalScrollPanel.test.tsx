import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExperimentalScrollPanel } from "./ExperimentalScrollPanel";
import { isExperimentalScrollSelection, resolveExperimentalScroll } from "./experimentalScrollSelection";
import { isSupportedSnapshot } from "./snapshotValidation";
import { createShareSnapshot } from "./privacy";
import { createAssetPackage } from "./assetPackage";
import { buildShareText } from "./shareSummary";
import type { SaveSnapshot } from "./types";
import fixture from "../public/data/demo-snapshot.json";
const make = (): SaveSnapshot => ({
  ...structuredClone(fixture) as unknown as SaveSnapshot,
  snapshotId: "synthetic-experimental-ui",
  scrolls: [{ recordIndex: 0, id: "DEA7", name: "Scroll of the Damned", nameZh: "百鬼夜行绘卷·地狱",
    level: 190, rarity: "Ethereal", attemptsRemaining: 1, effects: ["Ultimate Magic"], effectIds: ["2B06"], effectMagnitudes: [null],
    effectValueDetails: [{rawValue:150,kind:"condition",encoding:"not-decoded"}] }],
  experimentalScrollSelection: { formatVersion: 1, status: "candidate", reason: null,
    selectorOffset: "0x294070", encodingHypothesis: "uint32-le-table-index", rawSelector: 0,
    candidateRecord: { recordIndex: 0, id: "DEA7", offset: "0x294080" },
    selectionVerified: false, generalizationVerified: false, evidenceScope: "PRIVATE_RESEARCH_MARKER" },
});
afterEach(cleanup);
const enable = () => fireEvent.click(screen.getByRole("checkbox", {name:"开启实验绘卷识别"}));
describe("experimental scroll UI and contract", () => {
  it("defaults off; opt-in shows a candidate with source and scope, then hides it", () => {
    render(<ExperimentalScrollPanel snapshot={make()} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByText("实验引用的绘卷 · 候选")).not.toBeInTheDocument();
    enable();
    expect(screen.getByText("实验引用的绘卷 · 候选")).toBeVisible();
    expect(screen.getByText(/来源：所选快照的解密副本/)).toBeVisible();
    expect(screen.getByText(/游戏构建号未知/)).toBeVisible();
    expect(screen.getByText(/条件词条（非数值加成）/)).toBeVisible();
    enable();expect(screen.queryByText("实验引用的绘卷 · 候选")).not.toBeInTheDocument();
  });
  it("snapshot changes reset opt-in and never retain another snapshot record", () => {
    const s=make();const {rerender}=render(<ExperimentalScrollPanel snapshot={s} />);enable();
    rerender(<ExperimentalScrollPanel snapshot={{...s,snapshotId:"another"}} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByText("实验引用的绘卷 · 候选")).not.toBeInTheDocument();
  });
  it("old and unknown snapshots remain compatible without inventing a selection", () => {
    const s=make();delete s.experimentalScrollSelection;expect(isSupportedSnapshot(s)).toBe(true);
    const {rerender}=render(<ExperimentalScrollPanel snapshot={s} />);enable();
    expect(screen.getByText(/保持未知/)).toBeVisible();
    const unknown=make();unknown.experimentalScrollSelection={...unknown.experimentalScrollSelection!,
      status:"unknown",reason:"unverified-sentinel",rawSelector:0xffffffff,candidateRecord:null};
    expect(isSupportedSnapshot(unknown)).toBe(true);rerender(<ExperimentalScrollPanel snapshot={unknown} />);
    expect(screen.queryByText("实验引用的绘卷 · 候选")).not.toBeInTheDocument();
  });
  it("missing, duplicate or ID-mismatched referenced records stay unknown", () => {
    for(const rows of [[],[make().scrolls![0],make().scrolls![0]],[{...make().scrolls![0],id:"F40C"}]]) {
      expect(resolveExperimentalScroll({...make(),scrolls:rows})).toBeNull();
    }
  });
  it("rejects forged verification, offsets, uint32 and inconsistent unknown metadata", () => {
    const good=make().experimentalScrollSelection!;
    for(const bad of [
      {...good,selectionVerified:true},{...good,generalizationVerified:true},
      {...good,rawSelector:-1},{...good,candidateRecord:{...good.candidateRecord!,offset:"0x1"}},
      {...good,candidateRecord:{...good.candidateRecord!,recordIndex:248}},
      {...good,status:"unknown",reason:"bad"},{...good,status:{toString:"invalid"}},
    ]) {
      expect(isExperimentalScrollSelection(bad)).toBe(false);
      expect(isSupportedSnapshot({...make(),experimentalScrollSelection:bad})).toBe(false);
    }
  });
  it("public snapshot, asset package and text sharing exclude all research metadata", () => {
    const s=make();expect(isSupportedSnapshot(s)).toBe(true);
    for(const output of [createShareSnapshot(s),createAssetPackage(s,[]),buildShareText(s)]) {
      expect(JSON.stringify(output)).not.toContain("experimentalScrollSelection");
      expect(JSON.stringify(output)).not.toContain("PRIVATE_RESEARCH_MARKER");
      expect(JSON.stringify(output)).not.toContain("rawSelector");
    }
  });
});
