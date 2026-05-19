import { describe, expect, it } from "vitest";
import {
  applyLightweightTranscriptionCleanup,
  shouldPreservePunctuatedTranscript,
} from "../../src/pipeline/utils/transcription-cleanup";

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

  it("normalizes common dictation mistakes for Japanese punctuation wording", () => {
    expect(
      applyLightweightTranscriptionCleanup("駆読点が入力される", {
        language: "ja",
      }),
    ).toBe("句読点が入力される。");

    expect(
      applyLightweightTranscriptionCleanup("口読点とか苦読点", {
        language: "ja",
      }),
    ).toBe("句読点とか句読点。");
  });

  it("adds conservative Japanese punctuation hints to long final dictation", () => {
    expect(
      applyLightweightTranscriptionCleanup(
        "句読点がなかなか入らないね音声入力中のプレビューにたまに句読点が表示されるんだけど最終の貼り付けテキストには反映されてなかったりするからちなみにこれも音声入力で入れてるテキストねこんな感じになる",
        { language: "ja" },
      ),
    ).toBe(
      "句読点がなかなか入らないね。音声入力中のプレビューにたまに句読点が表示されるんだけど、最終の貼り付けテキストには反映されてなかったりするから。ちなみに、これも音声入力で入れてるテキストね。こんな感じになる。",
    );
  });

  it("keeps a punctuated chunk transcript when a final pass drops punctuation", () => {
    expect(
      shouldPreservePunctuatedTranscript(
        "句読点がなかなか入らないね。音声入力中のプレビューでは表示されるんだけど、最終には反映されない。",
        "句読点がなかなか入らないね音声入力中のプレビューでは表示されるんだけど最終には反映されない",
      ),
    ).toBe(true);
  });

  it("accepts a final pass when punctuation is not materially worse", () => {
    expect(
      shouldPreservePunctuatedTranscript(
        "句読点がなかなか入らないね。音声入力中のプレビューでは表示される。",
        "句読点がなかなか入らないね。音声入力中のプレビューでは表示される。",
      ),
    ).toBe(false);
  });
});
