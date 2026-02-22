/**
 * Multi-Provider Vision API
 *
 * Replaces hardcoded Gemini raw API calls in visual-classifier.ts.
 * Each provider has its own API format for image + text.
 */

import type { Provider } from "./types";

interface VisionRequest {
  imageBuffer: Buffer;
  prompt: string;
  apiKey: string;
  provider: Provider;
  modelId: string;
}

/**
 * Multi-provider vision API call.
 * Returns the raw text response from the model.
 */
export async function callVisionAPI(req: VisionRequest): Promise<string> {
  const base64Image = req.imageBuffer.toString("base64");

  switch (req.provider) {
    case "openai":
      return callOpenAIVision(req.modelId, base64Image, req.prompt, req.apiKey);
    case "anthropic":
      return callAnthropicVision(req.modelId, base64Image, req.prompt, req.apiKey);
    case "google":
      return callGeminiVision(req.modelId, base64Image, req.prompt, req.apiKey);
  }
}

async function callOpenAIVision(model: string, base64: string, prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      }],
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callAnthropicVision(model: string, base64: string, prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
        ],
      }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

async function callGeminiVision(model: string, base64: string, prompt: string, apiKey: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/jpeg", data: base64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 50 },
      }),
    }
  );
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
