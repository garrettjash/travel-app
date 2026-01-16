import type { NextApiRequest, NextApiResponse } from "next";

type HealthResponse = {
  status: "ok";
  message: string;
  timestamp: string;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>
) {
  res.status(200).json({
    status: "ok",
    message: "API is healthy",
    timestamp: new Date().toISOString()
  });
}
