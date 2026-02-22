/**
 * Nearby Places Tool using Google Places API (New)
 *
 * Searches for places near the user's current GPS location.
 * Uses the Places API textSearch endpoint with location bias.
 */

import { tool } from "ai";
import { z } from "zod";

interface PlaceResult {
  displayName?: { text: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: { openNow?: boolean };
}

/**
 * Create a places search tool bound to the user's current coordinates.
 */
export function createPlacesTool(lat: number, lng: number, apiKey: string) {
  return tool({
    description:
      "Search for nearby places like restaurants, cafes, gas stations, pharmacies, etc. " +
      "Use when the user asks to find a place near them. Returns the top results with name, address, rating, and open/closed status.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("What kind of place to search for, e.g. 'coffee shop', 'gas station', 'Italian restaurant'"),
      radius: z
        .number()
        .optional()
        .describe("Search radius in meters (default 1000, max 5000)"),
    }),
    execute: async ({ query, radius = 1000 }) => {
      console.log(`📍 Searching nearby places: "${query}" within ${radius}m of ${lat},${lng}`);

      try {
        const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.currentOpeningHours",
          },
          body: JSON.stringify({
            textQuery: query,
            locationBias: {
              circle: {
                center: { latitude: lat, longitude: lng },
                radius: Math.min(radius, 5000),
              },
            },
            maxResultCount: 5,
            languageCode: "en",
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error(`❌ Places API error: ${response.status} — ${errText}`);
          return { results: "Places search failed. Try asking me to search the web instead." };
        }

        const data = await response.json();
        const places: PlaceResult[] = data.places || [];

        if (places.length === 0) {
          return { results: `No results found for "${query}" near your location.` };
        }

        const formatted = places.map((p, i) => {
          const name = p.displayName?.text || "Unknown";
          const addr = p.formattedAddress || "";
          const rating = p.rating ? `${p.rating}★` : "";
          const reviews = p.userRatingCount ? `(${p.userRatingCount} reviews)` : "";
          const open = p.currentOpeningHours?.openNow !== undefined
            ? (p.currentOpeningHours.openNow ? "Open now" : "Closed")
            : "";
          return `${i + 1}. ${name} ${rating} ${reviews}\n   ${addr}${open ? ` — ${open}` : ""}`;
        }).join("\n\n");

        console.log(`✅ Places: found ${places.length} results`);
        return { results: formatted };

      } catch (error) {
        console.error("❌ Places search error:", error);
        return { results: "Places search failed due to an error." };
      }
    },
  });
}
