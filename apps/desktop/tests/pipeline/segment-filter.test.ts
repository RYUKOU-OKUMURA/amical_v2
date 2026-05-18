import { describe, expect, it } from "vitest";
import {
  isKnownHallucinationText,
  shouldDropSegment,
} from "../../src/pipeline/utils/segment-filter";

describe("segment-filter", () => {
  it("detects compact Japanese video-ending hallucinations", () => {
    expect(
      isKnownHallucinationText(
        "次の動画でお会いしましょう。ありがとうございます。",
      ),
    ).toBe(true);
  });

  it("does not drop longer text that only mentions a known phrase", () => {
    expect(
      isKnownHallucinationText(
        "YouTubeの最後に次の動画でお会いしましょうと言う例を説明します",
      ),
    ).toBe(false);
  });

  it("drops known hallucination segments at the stricter no-speech threshold", () => {
    expect(
      shouldDropSegment({
        text: "ご視聴ありがとうございました",
        noSpeechProb: 0.5,
      }),
    ).toBe(true);
  });
});
