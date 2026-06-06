import { describe, expect, it } from "vitest";
import {
  applyLongFormTranscriptionCleanup,
  applyLongFormPromptCleanup,
  applyLightweightTranscriptionCleanup,
  applyTranscriptionCleanupIfEnabled,
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

  it("skips cleanup when enablePunctuation is false", () => {
    const raw = "句読点がなかなか入らないね";
    expect(
      applyTranscriptionCleanupIfEnabled(raw, {
        enablePunctuation: false,
        skipLightweightCleanup: false,
        language: "ja",
      }),
    ).toBe(raw);
  });

  it("skips cleanup when lightweight cleanup is skipped for formatting", () => {
    const raw = "句読点がなかなか入らないね";
    expect(
      applyTranscriptionCleanupIfEnabled(raw, {
        enablePunctuation: true,
        skipLightweightCleanup: true,
        language: "ja",
      }),
    ).toBe(raw);
  });

  it("applies cleanup when punctuation is enabled and formatting is skipped", () => {
    expect(
      applyTranscriptionCleanupIfEnabled("もう少し早く表示されると嬉しい", {
        enablePunctuation: true,
        skipLightweightCleanup: false,
        language: "ja",
      }),
    ).toBe("もう少し早く表示されると嬉しい。");
  });

  it("collapses repeated filler loops in long-form dictation", () => {
    expect(
      applyLongFormTranscriptionCleanup(
        "喋りながら では、 では、 では、 見えてる",
      ),
    ).toBe("喋りながらでは、見えてる");
  });

  it("removes isolated long-dash loops in long-form dictation", () => {
    expect(
      applyLongFormTranscriptionCleanup(
        "ライブ配信のペースを2週間に1回にしようかなと思ってー ーー ーー ーーちゃんと告知",
      ),
    ).toBe("ライブ配信のペースを2週間に1回にしようかなと思ってーちゃんと告知");
  });

  it("removes adjacent duplicate sentence loops in long-form dictation", () => {
    expect(
      applyLongFormTranscriptionCleanup(
        "YouTubeを投稿しなきゃいい動画を出す。 か、YouTubeを投稿しなきゃいい動画を出す。 かられるようになっちゃって。",
      ),
    ).toBe("YouTubeを投稿しなきゃいい動画を出す。かられるようになっちゃって。");
  });

  it("does not strip duplicate markers without punctuation boundaries", () => {
    expect(
      applyLongFormTranscriptionCleanup("その話をします。話をします。"),
    ).toBe("その話をします。話をします。");
  });

  it("removes paired hai and thanks hallucinations without dropping intentional thanks", () => {
    expect(
      applyLongFormTranscriptionCleanup(
        "話している途中。はい。ありがとうございました。次の話。",
      ),
    ).toBe("話している途中。次の話。");

    expect(applyLongFormTranscriptionCleanup("ありがとうございました。")).toBe(
      "ありがとうございました。",
    );

    expect(
      applyLongFormTranscriptionCleanup(
        "今日はここまでです。ありがとうございました。",
      ),
    ).toBe("今日はここまでです。ありがとうございました。");
  });

  it("does not run punctuation insertion rules for long-form dictation", () => {
    expect(
      applyTranscriptionCleanupIfEnabled("もう少し早く表示されると嬉しい", {
        enablePunctuation: true,
        skipLightweightCleanup: false,
        language: "ja",
        dictationProfile: "long-form",
      }),
    ).toBe("もう少し早く表示されると嬉しい");
  });

  it("skips long-form cleanup after formatter cleanup is explicitly skipped", () => {
    const raw = "話している途中。はい。ありがとうございました。次の話。";
    expect(
      applyTranscriptionCleanupIfEnabled(raw, {
        enablePunctuation: true,
        skipLightweightCleanup: true,
        language: "ja",
        dictationProfile: "long-form",
      }),
    ).toBe(raw);
  });

  it("removes low-information long-form tails from prompt context", () => {
    expect(applyLongFormPromptCleanup("では、では、では、")).toBe("");
    expect(applyLongFormPromptCleanup("ここから話します。では、")).toBe(
      "ここから話します。",
    );
    expect(
      applyLongFormPromptCleanup(
        "今日はここまでです。ありがとうございました。",
      ),
    ).toBe("今日はここまでです。");
  });

  it("keeps English punctuation spacing during surface normalization", () => {
    expect(applyLongFormTranscriptionCleanup("Hello, world. Test")).toBe(
      "Hello, world. Test",
    );
  });
});
