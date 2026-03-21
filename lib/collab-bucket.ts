import fetch from "node-fetch";

export type Bucket = { label: string; ids: number[] };

export async function bucketAttractions(attractions: { id: number; name: string; summary?: string; categories?: string[] }[]) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const items = attractions.map((a) => ({ id: a.id, name: a.name, summary: a.summary ?? "", categories: a.categories ?? [] }));

  const system = `You are a helpful assistant that groups a list of attractions into semantically coherent buckets. Aim to create buckets that are roughly 7-10 items each when possible. Return a JSON object ONLY with the shape {"buckets": [{"label": string, "ids": [number,...]}, ...]}. Do not include explanations or markdown.`;

  const user = `Here are the attractions to bucket:\n${JSON.stringify(items)}\nCreate buckets and label them. Prefer human-friendly short labels like 'Places to Eat' or 'Things to See'.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.0,
        max_tokens: 1200
      })
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenAI error: ${res.status} ${txt}`);
    }

    const payload = await res.json();
    const content = String(payload?.choices?.[0]?.message?.content ?? "");

    // Try to extract JSON from the assistant content
    const firstBrace = content.indexOf("{");
    const jsonText = firstBrace >= 0 ? content.slice(firstBrace) : content;

    const parsed = JSON.parse(jsonText);
    if (!parsed || !Array.isArray(parsed.buckets)) throw new Error("Invalid bucket format from OpenAI");

    const buckets: Bucket[] = parsed.buckets.map((b: any) => ({ label: String(b.label ?? ""), ids: Array.isArray(b.ids) ? b.ids.map(Number) : [] }));
    return { buckets };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) } as any;
  }
}
