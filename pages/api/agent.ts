import type { NextApiRequest, NextApiResponse } from "next";

type AgentResponse = {
  output: string;
  session_id: string;
};

export default async function handler(
  request: NextApiRequest,
  response: NextApiResponse<AgentResponse | { error: string }>
) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method Not Allowed" });
  }

  const prompt = request.body?.prompt ?? "";
  const sessionId = request.body?.session_id ?? "";
  const userId = typeof request.body?.user_id === "string" ? request.body.user_id : undefined;
  const itineraryId = typeof request.body?.itinerary_id === "string" ? request.body.itinerary_id : undefined;
  const agentApiKey = process.env.AGENT_API_KEY;

  if (!prompt.trim()) {
    response.status(400).json({ error: "Prompt is required." });
    return;
  }

  if (!agentApiKey) {
    response.status(500).json({
      error: "Missing AGENT_API_KEY on server."
    });
    return;
  }

  const url = process.env.AGENT_ENDPOINT_URL;
  if (!url) {
    return response.status(500).json({ error: "AGENT_ENDPOINT_URL is not set" });
  }

  try {
    const agentResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": agentApiKey
      },
      body: JSON.stringify({
        prompt,
        session_id: sessionId,
        ...(userId && { user_id: userId }),
        ...(itineraryId && { itinerary_id: itineraryId })
      })
    });

    const responseData = await agentResponse.json();

    if (!agentResponse.ok) {
      console.error("[api/agent] Upstream error:", responseData);
      return response
        .status(agentResponse.status)
        .json({ error: "Upstream service returned an error." });
    }

    return response.status(200).json(responseData);
  } catch (error) {
    console.error("[api/agent] Fetch failed:", error);
    return response.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to call upstream agent."
    });
  }
}
