import type { NextApiRequest, NextApiResponse } from "next";

type AgentResponse = {
  data?: unknown;
  error?: string;
  requestId?: string;
};

const upstreamUrl =
  "https://t795umrb49.execute-api.us-east-1.amazonaws.com/agent";
const upstreamApiKey = process.env.AGENT_API_KEY;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AgentResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
  const sessionId =
    typeof req.body?.session_id === "string" ? req.body.session_id : "";

  if (!prompt.trim()) {
    res.status(400).json({ error: "Prompt is required." });
    return;
  }

  if (!upstreamApiKey) {
    res.status(500).json({
      error: "Missing AGENT_API_KEY on server."
    });
    return;
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": upstreamApiKey
      },
      body: JSON.stringify({
        prompt,
        session_id: sessionId
      })
    });

    const rawBody = await upstreamResponse.text();
    let parsedBody: unknown = rawBody;

    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      // Keep plain text when upstream does not return JSON.
    }

    if (!upstreamResponse.ok) {
      const requestId =
        upstreamResponse.headers.get("x-amzn-requestid") || "unknown";
      let errorMessage = "Upstream service returned an error.";
      if (typeof parsedBody === "string") {
        errorMessage = parsedBody;
      } else if (
        parsedBody &&
        typeof parsedBody === "object" &&
        "message" in parsedBody &&
        typeof (parsedBody as { message?: unknown }).message === "string"
      ) {
        errorMessage = (parsedBody as { message: string }).message;
      } else {
        errorMessage = JSON.stringify(parsedBody);
      }

      console.error(
        `[api/agent] Upstream error ${upstreamResponse.status} requestId=${requestId} body=${rawBody.slice(
          0,
          1000
        )}`
      );

      res.status(upstreamResponse.status).json({
        error: errorMessage,
        requestId
      });
      return;
    }

    res.status(200).json({ data: parsedBody });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to call upstream agent."
    });
  }
}
