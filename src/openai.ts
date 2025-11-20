import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "./env.ts";

export async function Response<TFormat extends z.ZodType>(
  prompt: string,
  format: TFormat,
): Promise<z.infer<TFormat>> {
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const res = await client.responses.parse({
    model: env.OPENAI_RESPONSE_MODEL,
    input: prompt,
    text: { format: zodTextFormat(format, "output") },
  });

  return res.output_parsed as z.infer<TFormat>;
}

export async function Embed(input: string): Promise<number[]>;
export async function Embed(input: Array<string>): Promise<number[][]>;
export async function Embed(input: string | Array<string>) {
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const res = await client.embeddings.create({
    input: input,
    model: env.OPENAI_EMBEDDING_MODEL,
    dimensions: 1536,
  });
  const embeddings = res.data.map((d) => d.embedding);

  if (typeof input === "string") {
    return embeddings[0];
  }

  return embeddings;
}
