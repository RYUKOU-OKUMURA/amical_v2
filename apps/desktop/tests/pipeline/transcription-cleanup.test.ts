import { describe, expect, it } from "vitest";
import { applyLightweightTranscriptionCleanup } from "../../src/pipeline/utils/transcription-cleanup";

describe("transcription-cleanup", () => {
  it("adds a Japanese terminal period when punctuation cleanup is enabled", () => {
    expect(
      applyLightweightTranscriptionCleanup("もう少し早く表示されると嬉しい", {
        language: "ja",
      }),
    ).toBe("もう少し早く表示されると嬉しい。");
  });

  it("normalizes Japanese question and exclamation punctuation", () => {
    expect(
      applyLightweightTranscriptionCleanup("これで通るかな? たぶん大丈夫!", {
        language: "ja",
      }),
    ).toBe("これで通るかな？たぶん大丈夫！");
  });

  it("removes trailing dots after existing terminal punctuation", () => {
    expect(
      applyLightweightTranscriptionCleanup("調査してもらえる?.", {
        language: "ja",
      }),
    ).toBe("調査してもらえる？");
  });

  it("does not add Japanese punctuation to English-only text", () => {
    expect(applyLightweightTranscriptionCleanup("OpenAI API test")).toBe(
      "OpenAI API test",
    );

    expect(
      applyLightweightTranscriptionCleanup("OpenAI API test", {
        language: "ja",
      }),
    ).toBe("OpenAI API test");
  });
});
