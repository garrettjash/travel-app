import type { NextApiRequest, NextApiResponse } from "next";
import { bucketAttractions } from "../../lib/collab-bucket";

export default async function handler(req: NextApiRequest, res: NextApiResponse<any>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const attractions = Array.isArray(req.body?.attractions) ? req.body.attractions : [];
  if (!Array.isArray(attractions) || attractions.length === 0) {
    res.status(400).json({ error: "attractions (array) required in body" });
    return;
  }

  try {
    const result = await bucketAttractions(attractions.map((a: any) => ({ id: Number(a.id), name: String(a.name ?? ""), summary: String(a.summary ?? ""), categories: Array.isArray(a.categories) ? a.categories : [] })));
    if (!result) {
      res.status(503).json({ error: "OpenAI key not configured on server" });
      return;
    }
    if ((result as any).error) {
      res.status(500).json({ error: (result as any).error });
      return;
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
