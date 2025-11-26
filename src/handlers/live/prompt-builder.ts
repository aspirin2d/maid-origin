// @ts-nocheck
import type { StoryContext, HandlerConfig } from "../index.ts";
import {
  getCharacterBasicSettings,
  getStreamProgramSettings,
  getResponseFormatSettings,
} from "./settings/index.ts";
import {
  buildTimeContext,
  buildMemoryContext,
  buildChatHistory,
} from "./context/index.ts";
import type { LiveEvent } from "./events.ts";
import { buildEventSpecificPrompt } from "./event-builders/index.ts";

/**
 * Cached system prompt to avoid repeated string concatenation
 */
let cachedSystemPrompt: string | null = null;

/**
 * Get default system prompt for VTuber
 * Combines all background settings into a complete prompt
 */
function getDefaultSystemPrompt(): string {
  if (!cachedSystemPrompt) {
    const sections = [
      getCharacterBasicSettings(),
      getStreamProgramSettings(),
      getResponseFormatSettings(),
    ];
    cachedSystemPrompt = sections.join("\n\n");
  }

  return cachedSystemPrompt;
}

/**
 * Build the complete prompt for the VTuber handler
 *
 * This is the main orchestrator that assembles the final prompt by:
 * 1. Getting the system prompt (character settings, stream info, format)
 * 2. Adding current time context
 * 3. Dispatching to event-specific prompt builder
 * 4. Conditionally fetching memories based on event type
 * 5. Fetching chat history
 * 6. Assembling all sections with event-specific content
 * 7. Adding final instructions for JSON formatting
 */
export async function buildPrompt(
  event: LiveEvent,
  ctx: StoryContext,
  config?: HandlerConfig,
): Promise<string> {
  const messageLimit = (config?.messageLimit as number | undefined) ?? 50;
  const systemPrompt =
    (config?.systemPrompt as string | undefined) ?? getDefaultSystemPrompt();

  const prompt: string[] = [systemPrompt, ""];

  // Add current time context
  prompt.push(buildTimeContext());
  prompt.push("");

  // Get event-specific prompt sections and metadata
  const eventPromptResult = await buildEventSpecificPrompt(event, ctx, config);

  // Conditionally fetch memory and chat history in parallel
  // Only fetch memories if the event type requires it
  const [memoryContext, chatHistory] = await Promise.all([
    eventPromptResult.requiresMemory
      ? buildMemoryContext(eventPromptResult.searchText, ctx, config)
      : Promise.resolve(null),
    buildChatHistory(ctx, messageLimit),
  ]);

  // Add memory context if available
  if (memoryContext) {
    prompt.push(memoryContext);
    prompt.push("");
  }

  // Add chat history
  prompt.push(chatHistory);
  prompt.push("");

  // Add event-specific prompt sections
  prompt.push(...eventPromptResult.sections);
  prompt.push("");

  // Add final instructions
  prompt.push(
    "请使用与提供的架构匹配的有效JSON进行响应。",
    "生成1-3个包含body、face和speech字段的片段，以实现富有表现力的VTuber回复。",
  );

  console.log(prompt.join("\n"));
  return prompt.join("\n");
}
