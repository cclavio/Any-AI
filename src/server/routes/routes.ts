/**
 * API Route Definitions
 *
 * Maps HTTP methods + paths to handler functions.
 * Each handler lives in its own file under api/.
 *
 * Auth middleware is applied to all routes — verified userId
 * is available via c.get("authUserId") in every handler.
 */

import { Hono } from "hono";
import { createAuthMiddleware } from "@mentra/sdk";
import { getHealth } from "../api/health";
import { photoStream, transcriptionStream } from "../api/stream";
import { speak, stopAudio } from "../api/audio";
import { getThemePreference, setThemePreference } from "../api/storage";
import { getLatestPhoto, getPhotoData, getPhotoBase64 } from "../api/photo";
import {
  getSettings,
  updateSettings,
  getProviderConfig,
  saveProviderConfig,
  validateProviderKey,
  deleteProviderConfig,
  getProviderCatalog,
  saveGoogleCloudKey,
  deleteGoogleCloudKey,
  validateGoogleCloudKeyEndpoint,
} from "../api/settings";
import { chatStream } from "../api/chat";
import { killSession } from "../api/debug";

const API_KEY = process.env.MENTRAOS_API_KEY || "";
const PACKAGE_NAME = process.env.PACKAGE_NAME || "";
const COOKIE_SECRET = process.env.COOKIE_SECRET || API_KEY;

export const api = new Hono();

// Health check is public (no auth required)
api.get("/health", getHealth);

// Apply SDK auth middleware to all other routes
const authMiddleware = createAuthMiddleware({
  apiKey: API_KEY,
  packageName: PACKAGE_NAME,
  cookieSecret: COOKIE_SECRET,
});
api.use("/*", authMiddleware);

// SSE streams
api.get("/photo-stream", photoStream);
api.get("/transcription-stream", transcriptionStream);
api.get("/chat/stream", chatStream);

// Audio
api.post("/speak", speak);
api.post("/stop-audio", stopAudio);

// Storage / preferences
api.get("/theme-preference", getThemePreference);
api.post("/theme-preference", setThemePreference);

// User settings
api.get("/settings", getSettings);
api.patch("/settings", updateSettings);

// Provider configuration (API keys, models)
api.get("/settings/provider", getProviderConfig);
api.post("/settings/provider", saveProviderConfig);
api.post("/settings/provider/validate", validateProviderKey);
api.delete("/settings/provider/:purpose", deleteProviderConfig);

// Google Cloud API key management
api.post("/settings/google-cloud", saveGoogleCloudKey);
api.delete("/settings/google-cloud", deleteGoogleCloudKey);
api.post("/settings/google-cloud/validate", validateGoogleCloudKeyEndpoint);

// Provider catalog (static, public-ish but still behind auth)
api.get("/providers/catalog", getProviderCatalog);

// Photos
api.get("/latest-photo", getLatestPhoto);
api.get("/photo/:requestId", getPhotoData);
api.get("/photo-base64/:requestId", getPhotoBase64);

// Debug (dev only)
if (process.env.NODE_ENV === "development") {
  api.post("/debug/kill-session", killSession);
}
