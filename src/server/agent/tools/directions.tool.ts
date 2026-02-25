/**
 * Directions Tool using Google Routes API
 *
 * Gets walking or driving directions from the user's current GPS location
 * to a destination address or place name.
 */

import { tool } from "ai";
import { z } from "zod";

interface RouteStep {
  navigationInstruction?: {
    maneuver?: string;
    instructions?: string;
  };
  distanceMeters?: number;
}

interface RouteLeg {
  steps?: RouteStep[];
}

interface Route {
  duration?: string;
  distanceMeters?: number;
  legs?: RouteLeg[];
}

/**
 * Create a directions tool bound to the user's current coordinates.
 */
export function createDirectionsTool(lat: number, lng: number, apiKey: string) {
  return tool({
    description:
      "Get walking or driving directions from the user's current location to a destination. " +
      "Use when the user asks how to get somewhere, wants directions, or asks about distance/travel time.",
    inputSchema: z.object({
      destination: z
        .string()
        .describe("The destination address or place name, e.g. 'Central Park' or '350 5th Ave, New York'"),
      mode: z
        .enum(["WALK", "DRIVE"])
        .optional()
        .describe("Travel mode — WALK (default for nearby) or DRIVE"),
    }),
    execute: async ({ destination, mode = "WALK" }) => {
      console.log(`🧭 Getting ${mode} directions to "${destination}" from ${lat},${lng}`);

      try {
        const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "routes.duration,routes.distanceMeters,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters",
          },
          body: JSON.stringify({
            origin: {
              location: { latLng: { latitude: lat, longitude: lng } },
            },
            destination: {
              address: destination,
            },
            travelMode: mode,
            computeAlternativeRoutes: false,
            languageCode: "en-US",
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error(`❌ Routes API error: ${response.status} — ${errText}`);
          const lower = errText.toLowerCase();
          if (response.status === 429 || lower.includes("quota") || lower.includes("resource_exhausted") || lower.includes("rate limit")) {
            return { results: "The Google Routes API has reached its usage limit. Please check your Google Cloud billing or quota settings." };
          }
          if (lower.includes("billing")) {
            return { results: "The Google Routes API requires billing to be enabled in your Google Cloud Console." };
          }
          if (response.status === 403) {
            return { results: "The Google Routes API isn't enabled for your API key. Please enable it in Google Cloud Console." };
          }
          return { results: "Could not get directions. Try asking me to search the web instead." };
        }

        const data = await response.json();
        const routes: Route[] = data.routes || [];

        if (routes.length === 0) {
          return { results: `No route found to "${destination}".` };
        }

        const route = routes[0];

        // Parse duration (comes as "300s" format)
        const durationSec = parseInt(route.duration?.replace("s", "") || "0", 10);
        const durationMin = Math.round(durationSec / 60);
        const durationStr = durationMin >= 60
          ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}min`
          : `${durationMin} min`;

        // Parse distance
        const distanceM = route.distanceMeters || 0;
        const distanceMiles = (distanceM / 1609.34).toFixed(1);

        // Build step-by-step instructions
        const steps = route.legs?.[0]?.steps || [];
        const stepLines = steps
          .filter((s) => s.navigationInstruction?.instructions)
          .map((s, i) => {
            const dist = s.distanceMeters
              ? s.distanceMeters >= 1000
                ? `${(s.distanceMeters / 1609.34).toFixed(1)} mi`
                : `${Math.round(s.distanceMeters * 3.281)} ft`
              : "";
            return `${i + 1}. ${s.navigationInstruction!.instructions}${dist ? ` (${dist})` : ""}`;
          })
          .join("\n");

        const modeLabel = mode === "WALK" ? "Walking" : "Driving";
        const summary = `${modeLabel} directions to ${destination}:\nDistance: ${distanceMiles} miles | Time: ~${durationStr}\n\n${stepLines || "Head towards the destination."}`;

        console.log(`✅ Directions: ${distanceMiles} mi, ~${durationStr}, ${steps.length} steps`);
        return { results: summary };

      } catch (error) {
        console.error("❌ Directions error:", error);
        return { results: "Directions failed due to an error." };
      }
    },
  });
}
