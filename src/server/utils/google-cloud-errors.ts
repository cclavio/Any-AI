/**
 * Google Cloud API Error Classification
 *
 * Parses HTTP responses and error objects from Google Cloud APIs
 * to produce user-friendly spoken feedback.
 */

export type GoogleCloudErrorKind =
  | "quota_exceeded"      // 429 or RESOURCE_EXHAUSTED — usage limit hit
  | "billing_disabled"    // 403 with billing message — free tier expired or billing not enabled
  | "permission_denied"   // 403 — API not enabled or key lacks access
  | "invalid_key"         // 401 or API_KEY_INVALID — bad/revoked key
  | "not_found"           // 404 — API endpoint or resource doesn't exist
  | "server_error"        // 5xx — Google's side
  | "unknown";            // Anything else

export interface GoogleCloudError {
  kind: GoogleCloudErrorKind;
  api: string;           // e.g., "Weather", "Places", "Air Quality"
  status: number;
  message: string;       // Raw error detail from Google
  userMessage: string;   // Friendly spoken message
}

/**
 * Classify a non-OK HTTP response from a Google Cloud API.
 * Pass the response object and the API name for context.
 */
export async function classifyGoogleCloudError(
  response: Response,
  api: string,
): Promise<GoogleCloudError> {
  const status = response.status;
  let message = "";

  try {
    const text = await response.text();
    // Try to extract the error message from JSON
    try {
      const json = JSON.parse(text);
      message = json.error?.message || json.error?.status || text.slice(0, 200);
    } catch {
      message = text.slice(0, 200);
    }
  } catch {
    message = `HTTP ${status}`;
  }

  const kind = classifyByStatusAndMessage(status, message);
  const userMessage = buildUserMessage(kind, api);

  return { kind, api, status, message, userMessage };
}

/**
 * Classify a thrown error (e.g., from @googlemaps/google-maps-services-js).
 */
export function classifyThrownGoogleError(
  error: unknown,
  api: string,
): GoogleCloudError {
  const message = error instanceof Error ? error.message : String(error);
  const status = extractStatusFromError(error);
  const kind = classifyByStatusAndMessage(status, message);
  const userMessage = buildUserMessage(kind, api);

  return { kind, api, status, message, userMessage };
}

function extractStatusFromError(error: unknown): number {
  if (error && typeof error === "object") {
    // @googlemaps/google-maps-services-js puts status in response.status
    const e = error as any;
    if (e.response?.status) return e.response.status;
    if (e.status) return e.status;
    if (e.code === "ENOTFOUND" || e.code === "ECONNREFUSED") return 0;
  }
  return 0;
}

function classifyByStatusAndMessage(status: number, message: string): GoogleCloudErrorKind {
  const lower = message.toLowerCase();

  // 429 — rate limit / quota
  if (status === 429) return "quota_exceeded";

  // RESOURCE_EXHAUSTED in the message body (sometimes comes as 403)
  if (lower.includes("resource_exhausted") || lower.includes("quota") || lower.includes("rate limit")) {
    return "quota_exceeded";
  }

  // Billing
  if (lower.includes("billing") || lower.includes("payment") || lower.includes("account_billing")) {
    return "billing_disabled";
  }

  // 401 or explicit invalid key
  if (status === 401 || lower.includes("api_key_invalid") || lower.includes("api key not valid")) {
    return "invalid_key";
  }

  // 403 — permission denied (API not enabled, key restrictions, etc.)
  if (status === 403) {
    if (lower.includes("has not been used") || lower.includes("is not enabled") || lower.includes("permission_denied")) {
      return "permission_denied";
    }
    // 403 without clear billing/permission message — likely quota
    return "quota_exceeded";
  }

  // 404
  if (status === 404) return "not_found";

  // 5xx
  if (status >= 500) return "server_error";

  return "unknown";
}

function buildUserMessage(kind: GoogleCloudErrorKind, api: string): string {
  switch (kind) {
    case "quota_exceeded":
      return `Your Google Cloud ${api} API has reached its usage limit. You may need to check your Google Cloud billing or quota settings.`;
    case "billing_disabled":
      return `Your Google Cloud ${api} API requires billing to be enabled. Please check your Google Cloud Console billing settings.`;
    case "permission_denied":
      return `The Google Cloud ${api} API isn't enabled for your API key. Please enable it in your Google Cloud Console.`;
    case "invalid_key":
      return `Your Google Cloud API key appears to be invalid. Please check your API key in Settings.`;
    case "server_error":
      return `The Google ${api} service is temporarily unavailable. Please try again in a moment.`;
    case "not_found":
      return `The Google Cloud ${api} API endpoint was not found. Your API key may need the ${api} API enabled.`;
    case "unknown":
      return `There was an issue with the Google Cloud ${api} service. Please try again.`;
  }
}
