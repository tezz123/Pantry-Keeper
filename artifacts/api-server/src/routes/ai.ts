import { Router, type IRouter } from "express";
import { AnalyzePantryLabelBody } from "@workspace/api-zod";

const router: IRouter = Router();
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3.8-flash";

function extractJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? content.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as {
      name?: unknown;
      expiryDate?: unknown;
      confidence?: unknown;
    };
  } catch {
    return null;
  }
}

router.post("/ai/analyze-label", async (req, res) => {
  const parsed = AnalyzePantryLabelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A label photo and scan type are required." });
    return;
  }

  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "OpenRouter is not configured for this project." });
    return;
  }

  const { kind, imageData, model } = parsed.data;
  const prompt =
    kind === "product"
      ? "Read the main food product name from this pantry label. Ignore brand slogans, nutrition facts, and marketing copy."
      : "Read the best-before or expiry date from this pantry label. Convert it to YYYY-MM-DD. If only month and year are visible, use the last day of that month. Do not invent a date.";

  try {
    const providerResponse = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://replit.com",
        "X-Title": "Pantry Keeper",
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 8192,
        messages: [
          {
            role: "system",
            content:
              'Return only valid JSON with the keys "name", "expiryDate", and "confidence". Use an empty string when a field cannot be read.',
          },
          {
            role: "user",
            content: [
              { type: "text", text: `${prompt} Return JSON only.` },
              { type: "image_url", image_url: { url: imageData } },
            ],
          },
        ],
      }),
    });

    if (!providerResponse.ok) {
      const details = await providerResponse.text();
      req.log.error({ status: providerResponse.status, details }, "OpenRouter label analysis failed");
      res.status(502).json({ error: "OpenRouter could not read this label." });
      return;
    }

    const payload = (await providerResponse.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    const result = typeof content === "string" ? extractJson(content) : null;

    if (!result) {
      res.status(502).json({ error: "The AI returned an unreadable result." });
      return;
    }

    res.json({
      name: typeof result.name === "string" ? result.name.trim() : "",
      expiryDate: typeof result.expiryDate === "string" ? result.expiryDate.trim() : "",
      confidence:
        typeof result.confidence === "number" && Number.isFinite(result.confidence)
          ? result.confidence
          : 0,
    });
  } catch (error) {
    req.log.error({ error }, "Label analysis request failed");
    res.status(502).json({ error: "The AI provider could not be reached." });
  }
});

export default router;