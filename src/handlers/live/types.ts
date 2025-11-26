export interface HandlerConfig {
  messageLimit?: number;
  systemPrompt?: string;
  memoryTopK?: number;
  memoryMinSimilarity?: number;
}

export interface StoryContext {
  storyId: number;
  userId: string;
  provider?: string | null;
}
