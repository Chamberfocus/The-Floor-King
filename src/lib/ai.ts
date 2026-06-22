// Small server-side helper for one-shot text generation via the Anthropic API.
// Reuses ANTHROPIC_API_KEY. Returns a clear error instead of throwing.

interface AiBlock {
  type: string;
  text?: string;
}

export async function aiText(opts: {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ text: string; error: string | null }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { text: "", error: "AI isn't set up (ANTHROPIC_API_KEY)." };

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: opts.maxTokens ?? 700,
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: "user", content: opts.prompt }],
      }),
    });
  } catch {
    return { text: "", error: "Couldn't reach the AI service." };
  }

  if (!res.ok) {
    let reason = `AI error (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) reason = `AI error: ${body.error.message}`;
    } catch {
      /* ignore */
    }
    return { text: "", error: reason };
  }

  try {
    const json = (await res.json()) as { content?: AiBlock[] };
    const text =
      json.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
    return { text, error: text ? null : "AI returned nothing." };
  } catch {
    return { text: "", error: "Couldn't read the AI response." };
  }
}
