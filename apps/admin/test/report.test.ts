import { notScoreableReasonSchema } from "@boca/contracts";
import { describe, expect, it } from "vitest";
import {
  formatConfidence,
  formatMedian,
  isTerminalStatus,
  NOT_SCOREABLE_REASON_RO,
  scoreTone,
  verdictForMedian,
} from "../src/lib/report";

describe("verdictForMedian", () => {
  it("maps boundary medians to the locked verdict buckets", () => {
    expect(verdictForMedian(5).tone).toBe("good");
    expect(verdictForMedian(4.5).label).toBe("Conform cu standardul");
    expect(verdictForMedian(4).label).toBe("Conform, cu observații minore");
    expect(verdictForMedian(3.5).tone).toBe("good");
    expect(verdictForMedian(3).tone).toBe("mixed");
    expect(verdictForMedian(2.5).tone).toBe("mixed");
    expect(verdictForMedian(2).tone).toBe("bad");
    expect(verdictForMedian(1).label).toBe("Neconform — necesită replatare");
  });
});

describe("scoreTone", () => {
  it("buckets the 1-5 scale", () => {
    expect(scoreTone(5)).toBe("good");
    expect(scoreTone(4)).toBe("good");
    expect(scoreTone(3)).toBe("mixed");
    expect(scoreTone(2)).toBe("bad");
    expect(scoreTone(1)).toBe("bad");
  });
});

describe("formatting", () => {
  it("renders medians with a Romanian decimal comma, one decimal", () => {
    expect(formatMedian(4)).toBe("4,0");
    expect(formatMedian(3.5)).toBe("3,5");
  });

  it("renders confidence as a whole percent", () => {
    expect(formatConfidence(0)).toBe("0%");
    expect(formatConfidence(0.825)).toBe("83%");
    expect(formatConfidence(1)).toBe("100%");
  });
});

describe("NOT_SCOREABLE_REASON_RO", () => {
  it("covers every not_scoreable_reason enum value (anti-drift)", () => {
    expect(Object.keys(NOT_SCOREABLE_REASON_RO).sort()).toEqual(
      [...notScoreableReasonSchema.options].sort(),
    );
  });
});

describe("isTerminalStatus", () => {
  it("stops polling only on terminal statuses", () => {
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("not_scoreable")).toBe(true);
    expect(isTerminalStatus("eval_failed")).toBe(true);
  });
});
