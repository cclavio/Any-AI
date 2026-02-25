/**
 * Bridge types — request/response shapes for the Claude Code ↔ Mentra bridge API.
 */

export interface BridgeNotifyRequest {
  message: string;
  conversationId?: string;
  timeoutMs?: number; // default: 600000 (10 min)
}

export interface BridgeNotifyResponse {
  requestId: string;
  status: "responded" | "timeout";
  transcript?: string;
  conversationId: string;
  message?: string; // human-readable status for timeout case
}

export interface BridgeSpeakRequest {
  message: string;
  conversationId?: string;
}

export interface BridgePairGenerateResponse {
  code: string;
  expiresInSeconds: number;
  instructions: string;
}

export interface BridgePairConfirmRequest {
  code: string;
}

export interface BridgePairStatusResponse {
  paired: boolean;
  displayName?: string;
}

export interface BridgeDeferredMessage {
  requestId: string;
  message: string;
  conversationId?: string;
  response?: string;
  deferredAt: string;
  respondedAt?: string;
}

export interface BridgePendingResponse {
  pending: BridgeDeferredMessage[];
  answered: BridgeDeferredMessage[];
}

/** In-memory state for a parked request */
export interface ParkedRequest {
  requestId: string;
  message: string;
  conversationId: string;
  resolve: (response: BridgeNotifyResponse) => void;
  reject: (error: Error) => void;
  timeoutTimer: ReturnType<typeof setTimeout>;
  warningTimer: ReturnType<typeof setTimeout> | null;
}
