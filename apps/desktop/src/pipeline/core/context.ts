/**
 * Simple context management for the pipeline - no over-engineering
 * Based on ARCHITECTURE.md specifications
 */

export interface PipelineContext {
  sessionId: string;
  sharedData: SharedPipelineData;
  metadata: Map<string, unknown>;
}

import { GetAccessibilityContextResult } from "@amical/types";

export type FormattingStyle =
  | "dialogue"
  | "organize"
  | "summary"
  | "formal"
  | "casual"
  | "technical";

export interface SharedPipelineData {
  vocabulary: string[]; // Custom vocab
  replacements: Map<string, string>; // Custom replacements
  userPreferences: {
    language?: string; // Optional - undefined means auto-detect
    formattingStyle: FormattingStyle;
  };
  audioMetadata: {
    source: "microphone" | "file" | "stream";
    duration?: number;
  };
  accessibilityContext: GetAccessibilityContextResult | null;
}

/**
 * Create a default context for pipeline execution
 */
export function createDefaultContext(sessionId: string): PipelineContext {
  return {
    sessionId,
    sharedData: {
      vocabulary: [],
      replacements: new Map(),
      userPreferences: {
        language: undefined,
        formattingStyle: "dialogue",
      },
      audioMetadata: {
        source: "microphone",
      },
      accessibilityContext: null, // Will be populated async by TranscriptionService
    },
    metadata: new Map(),
  };
}
