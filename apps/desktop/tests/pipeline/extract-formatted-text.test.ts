import { describe, expect, it } from "vitest";
import { extractFormattedText } from "../../src/pipeline/providers/formatting/extract-formatted-text";

describe("extractFormattedText", () => {
  it("removes structural line breaks around formatted text", () => {
    expect(
      extractFormattedText(
        "<formatted_text>\nこれはテストです。\n</formatted_text>",
        "これはテストです",
      ),
    ).toEqual({
      text: "これはテストです。",
      usedFallback: false,
    });
  });

  it("removes CRLF structural line breaks and trailing tag indentation", () => {
    expect(
      extractFormattedText(
        "<formatted_text>\r\nこれはテストです。\r\n  </formatted_text>",
        "これはテストです",
      ).text,
    ).toBe("これはテストです。");
  });

  it("preserves intentional leading spacing for context insertion", () => {
    expect(
      extractFormattedText(
        "<formatted_text>\n 続きの文章です。\n</formatted_text>",
        "続きの文章です",
      ).text,
    ).toBe(" 続きの文章です。");
  });

  it("keeps internal paragraph breaks", () => {
    expect(
      extractFormattedText(
        "<formatted_text>\n見出し\n\n本文です。\n</formatted_text>",
        "見出し 本文です",
      ).text,
    ).toBe("見出し\n\n本文です。");
  });

  it("falls back when formatted text is only whitespace", () => {
    expect(
      extractFormattedText("<formatted_text>\n\n</formatted_text>", "元の文章"),
    ).toEqual({
      text: "元の文章",
      usedFallback: true,
      reason: "whitespace_only",
    });
  });
});
