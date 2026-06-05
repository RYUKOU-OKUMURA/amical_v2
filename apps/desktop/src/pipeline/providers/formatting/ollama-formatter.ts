import { FormattingProvider, FormatParams } from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { constructFormatterPrompt } from "./formatter-prompt";
import { extractFormattedText } from "./extract-formatted-text";
import { normalizeOllamaUrl } from "../../../utils/provider-utils";
import { getUserAgent } from "../../../utils/http-client";
import { calculateFormattingMaxTokens } from "../../utils/latency-limits";

export class OllamaFormatter implements FormattingProvider {
  readonly name = "ollama";

  constructor(
    private ollamaUrl: string,
    private model: string,
  ) {
    this.ollamaUrl = normalizeOllamaUrl(ollamaUrl);
  }

  async format(params: FormatParams): Promise<string> {
    try {
      const { text, context } = params;

      // Construct the formatter prompt using the same function as OpenRouter
      const { systemPrompt, userPrompt } = constructFormatterPrompt(context);
      const userPromptContent = userPrompt(text);
      const requestPayload = {
        provider: this.name,
        endpoint: `${this.ollamaUrl}/api/chat`,
        model: this.model,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: calculateFormattingMaxTokens(text.length),
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPromptContent },
        ],
      };

      logger.pipeline.debug("Formatting LLM request payload", requestPayload);

      // Use Ollama's chat endpoint for system/user message structure
      const response = await fetch(requestPayload.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
        },
        signal: params.signal,
        body: JSON.stringify({
          model: requestPayload.model,
          messages: requestPayload.messages,
          stream: requestPayload.stream,
          options: requestPayload.options,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data.message?.content ?? "";

      logger.pipeline.debug("Formatting LLM raw response", {
        provider: this.name,
        model: this.model,
        rawResponse: aiResponse,
      });

      // Extract formatted text from XML tags, with original input as fallback
      const extraction = extractFormattedText(aiResponse, text);

      if (extraction.usedFallback) {
        logger.pipeline.warn(
          {
            model: this.model,
            reason: extraction.reason,
            rawResponseLength: aiResponse.length,
          },
          "Formatting XML extraction failed, returning original text",
        );
      }

      logger.pipeline.debug("Formatting LLM parsed response", {
        provider: this.name,
        original: text,
        formatted: extraction.text,
        usedFallback: extraction.usedFallback,
        fallbackReason: extraction.reason,
      });

      return extraction.text;
    } catch (error) {
      logger.pipeline.error("Formatting failed:", error);
      throw error;
    }
  }
}
