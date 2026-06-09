import { describe, expect, it } from "vitest";
import type { GetAccessibilityContextResult } from "@amical/types";
import {
  constructFormatterPrompt,
  shouldIncludeSurroundingTextContext,
} from "../../src/pipeline/providers/formatting/formatter-prompt";

function accessibilityContext(
  bundleIdentifier: string,
): GetAccessibilityContextResult {
  return {
    context: {
      application: {
        bundleIdentifier,
        name: "Test App",
      },
      textSelection: {
        preSelectionText: "Before text",
        postSelectionText: "フォローアップの変更を求める",
      },
    },
  } as GetAccessibilityContextResult;
}

describe("formatter prompt surrounding text context", () => {
  it("defaults to dialogue mode to preserve dictated speech", () => {
    const { systemPrompt } = constructFormatterPrompt({
      accessibilityContext: accessibilityContext("com.apple.TextEdit"),
    });

    expect(systemPrompt).toContain("Dialogue / セリフモード");
    expect(systemPrompt).toContain(
      "Do NOT convert the speech into instructions",
    );
  });

  it("includes an explicit organize mode when requested", () => {
    const { systemPrompt } = constructFormatterPrompt({
      accessibilityContext: accessibilityContext("com.apple.TextEdit"),
      style: "organize",
    });

    expect(systemPrompt).toContain("Organize / 整理モード");
  });

  it("omits unreliable Codex surrounding text from formatter prompts", () => {
    const context = accessibilityContext("com.openai.codex");

    expect(shouldIncludeSurroundingTextContext(context)).toBe(false);

    const { systemPrompt } = constructFormatterPrompt({
      accessibilityContext: context,
    });

    expect(systemPrompt).not.toContain("フォローアップの変更を求める");
    expect(systemPrompt).not.toContain(
      "<before_text>Before text</before_text>",
    );
    expect(systemPrompt).not.toContain(
      "<after_text>フォローアップの変更を求める</after_text>",
    );
  });

  it("keeps surrounding text for native text targets", () => {
    const context = accessibilityContext("com.apple.TextEdit");

    expect(shouldIncludeSurroundingTextContext(context)).toBe(true);

    const { systemPrompt } = constructFormatterPrompt({
      accessibilityContext: context,
    });

    expect(systemPrompt).toContain("<before_text>Before text</before_text>");
    expect(systemPrompt).toContain(
      "<after_text>フォローアップの変更を求める</after_text>",
    );
  });
});
