type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function generateShortOpenAiText(args: {
  prompt: string;
  system: string;
  maxTokens: number;
  timeoutMs?: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.prompt },
      ],
      max_tokens: args.maxTokens,
      temperature: 0.95,
    }),
    // Provider latency must not consume the full serverless function budget.
    signal: AbortSignal.timeout(args.timeoutMs ?? 8_000),
  });

  if (!response.ok) return null;
  const payload = await response.json() as ChatCompletionResponse;
  const text = payload.choices?.[0]?.message?.content?.trim();
  return text ? text.slice(0, 1_000) : null;
}
