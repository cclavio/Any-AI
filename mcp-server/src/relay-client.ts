/**
 * HTTP client for the Mentra bridge API.
 * Wraps fetch calls to the Any AI server's /api/bridge/ endpoints.
 */

export interface PairGenerateResponse {
  code: string;
  expiresInSeconds: number;
  instructions: string;
}

export interface PairStatusResponse {
  paired: boolean;
  displayName?: string;
}

export interface NotifyResponse {
  requestId: string;
  status: "responded" | "timeout";
  transcript?: string;
  conversationId: string;
  message?: string;
}

export interface PendingMessage {
  requestId: string;
  message: string;
  conversationId?: string;
  response?: string;
  deferredAt: string;
  respondedAt?: string;
}

export interface PendingResponse {
  pending: PendingMessage[];
  answered: PendingMessage[];
}

export class RelayClient {
  private relayUrl: string;
  private apiKey: string;

  constructor(relayUrl: string, apiKey: string) {
    this.relayUrl = relayUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<Response> {
    const url = `${this.relayUrl}/api/bridge${path}`;
    const controller = new AbortController();
    const timer = timeoutMs
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return response;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async generatePairingCode(): Promise<PairGenerateResponse> {
    const res = await this.request("POST", "/pair/generate");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || `Failed to generate pairing code (${res.status})`);
    }
    return res.json();
  }

  async getPairingStatus(): Promise<PairStatusResponse> {
    const res = await this.request("GET", "/pair/status");
    if (!res.ok) throw new Error(`Failed to get pairing status (${res.status})`);
    return res.json();
  }

  async notify(
    message: string,
    conversationId?: string,
    timeoutMs?: number,
  ): Promise<NotifyResponse> {
    // Long-poll: generous client-side timeout (12 min for 10 min server timeout + buffer)
    const clientTimeout = (timeoutMs ?? 600_000) + 120_000;
    const res = await this.request(
      "POST",
      "/notify",
      {
        message,
        ...(conversationId ? { conversationId } : {}),
        ...(timeoutMs ? { timeoutMs } : {}),
      },
      clientTimeout,
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || `Notify failed (${res.status})`);
    }
    return res.json();
  }

  async speak(message: string, conversationId?: string): Promise<void> {
    const res = await this.request("POST", "/speak", {
      message,
      ...(conversationId ? { conversationId } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || `Speak failed (${res.status})`);
    }
  }

  async endConversation(message?: string, conversationId?: string): Promise<void> {
    const res = await this.request("POST", "/end", {
      ...(message ? { message } : {}),
      ...(conversationId ? { conversationId } : {}),
    });
    if (!res.ok) throw new Error(`End conversation failed (${res.status})`);
  }

  async checkPending(): Promise<PendingResponse> {
    const res = await this.request("GET", "/pending");
    if (!res.ok) throw new Error(`Check pending failed (${res.status})`);
    return res.json();
  }
}
