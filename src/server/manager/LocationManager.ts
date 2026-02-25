/**
 * LocationManager - Handles GPS location, reverse geocoding, and weather
 *
 * Features:
 * - Per-session caching to prevent excessive API calls
 * - Lazy geocoding (only fetch when needed)
 * - Google Maps integration for reverse geocoding
 * - Google Weather API integration
 */

import { Client } from "@googlemaps/google-maps-services-js";
import type { User } from "../session/User";
import { isLocationQuery, isWeatherQuery, isAirQualityQuery, isPollenQuery, isTimeQuery } from "../utils/location-keywords";
import { LOCATION_CACHE_SETTINGS } from "../constants/config";
import { classifyGoogleCloudError, classifyThrownGoogleError, type GoogleCloudError } from "../utils/google-cloud-errors";

// Google Maps client
const mapsClient = new Client({});

/**
 * Weather condition data
 */
export interface WeatherCondition {
  temperature: number;         // Fahrenheit
  temperatureCelsius: number;  // Celsius
  condition: string;           // e.g., "Sunny", "Cloudy"
  humidity?: number;
  wind?: string;
}

/**
 * Air quality data
 */
export interface AirQualityData {
  aqi: number;                 // Universal AQI (0-500)
  category: string;            // e.g., "Good air quality"
  dominantPollutant: string;   // e.g., "pm25"
}

/**
 * Pollen data
 */
export interface PollenData {
  grass: { level: string; value: number } | null;
  tree: { level: string; value: number } | null;
  weed: { level: string; value: number } | null;
}

/**
 * Complete location context
 */
export interface LocationContext {
  // Coordinates
  lat: number;
  lng: number;

  // Geocoded address
  city: string;
  state: string;
  country: string;
  streetAddress?: string;
  neighborhood?: string;

  // Timezone (from SDK)
  timezone?: string;

  // Weather
  weather?: WeatherCondition;

  // Air quality
  airQuality?: AirQualityData;

  // Pollen
  pollen?: PollenData;

  // Cache metadata
  geocodedAt: number;
  weatherFetchedAt: number;
  airQualityFetchedAt: number;
  pollenFetchedAt: number;
}

/**
 * LocationManager — handles GPS, geocoding, and weather for a single user session.
 */
export class LocationManager {
  // Current raw coordinates
  private currentLat: number | null = null;
  private currentLng: number | null = null;

  // Timezone stored independently (set from SDK before cachedContext exists)
  private userTimezone: string | null = null;

  // Cached location context (per-session)
  private cachedContext: LocationContext | null = null;
  private lastGeocodedLat: number | null = null;
  private lastGeocodedLng: number | null = null;

  // Last Google Cloud API error (cleared on next successful call)
  private _lastApiError: GoogleCloudError | null = null;

  constructor(private user: User) {
    console.log(`📍 LocationManager init for ${user.userId}`);
  }

  /** Get the last Google Cloud API error (if any). Cleared on successful calls. */
  get lastApiError(): GoogleCloudError | null {
    return this._lastApiError;
  }

  /** Clear the last API error (call after reporting to user). */
  clearApiError(): void {
    this._lastApiError = null;
  }

  /** Per-user Google Cloud API key (loaded from Vault via aiConfig) */
  private get googleApiKey(): string | null {
    return this.user.aiConfig?.googleCloudApiKey || null;
  }

  /** Whether the user has Google Cloud services configured */
  hasGoogleServices(): boolean {
    return !!this.googleApiKey;
  }

  /**
   * Update raw coordinates (called when SDK sends location update)
   */
  updateCoordinates(lat: number, lng: number): void {
    this.currentLat = lat;
    this.currentLng = lng;
    console.log(`📍 Location updated for ${this.user.userId}: ${lat}, ${lng}`);

    // If no timezone set yet (MentraOS didn't provide one), auto-detect from GPS
    if (!this.userTimezone && this.googleApiKey) {
      console.log(`🕐 Attempting timezone auto-detect from GPS for ${this.user.userId}...`);
      this.fetchTimezoneFromCoordinates(lat, lng).then((tz) => {
        if (tz && !this.userTimezone) {
          this.setTimezone(tz);
          console.log(`🕐 Timezone auto-detected from GPS: ${tz}`);
        } else if (!tz) {
          console.warn(`⚠️ Timezone auto-detect returned null for ${lat}, ${lng}`);
        } else {
          console.log(`🕐 Timezone already set (${this.userTimezone}), skipping GPS result: ${tz}`);
        }
      });
    } else if (this.userTimezone) {
      console.log(`🕐 Timezone already set: ${this.userTimezone}, skipping auto-detect`);
    } else if (!this.googleApiKey) {
      console.warn(`⚠️ Cannot auto-detect timezone: Google Cloud API key not configured`);
    }
  }

  /**
   * Check if we have valid coordinates
   */
  hasLocation(): boolean {
    return this.currentLat !== null && this.currentLng !== null;
  }

  /**
   * Get current coordinates
   */
  getCoordinates(): { lat: number; lng: number } | null {
    if (!this.hasLocation()) return null;
    return { lat: this.currentLat!, lng: this.currentLng! };
  }

  /**
   * Check if a query needs location data
   */
  queryNeedsLocation(query: string): boolean {
    return isLocationQuery(query) || isWeatherQuery(query) || isTimeQuery(query);
  }

  /**
   * Check if a query needs weather specifically
   */
  queryNeedsWeather(query: string): boolean {
    return isWeatherQuery(query);
  }

  /**
   * Check if a query needs air quality data
   */
  queryNeedsAirQuality(query: string): boolean {
    return isAirQualityQuery(query);
  }

  /**
   * Check if a query needs pollen data
   */
  queryNeedsPollen(query: string): boolean {
    return isPollenQuery(query);
  }

  /**
   * Fetch location context (with caching)
   * Only makes API calls if cache is invalid
   */
  async fetchContextIfNeeded(query: string): Promise<LocationContext | null> {
    if (!this.hasLocation()) {
      console.log(`⚠️ No location available for ${this.user.userId}`);
      return null;
    }

    const lat = this.currentLat!;
    const lng = this.currentLng!;

    // Check if we need to refresh geocoding
    const needsGeocoding = this.shouldRefreshGeocoding(lat, lng);

    // Check if we need to refresh weather
    const needsWeather = this.queryNeedsWeather(query) && this.shouldRefreshWeather();
    const needsAirQuality = this.queryNeedsAirQuality(query) && this.shouldRefreshAirQuality();
    const needsPollen = this.queryNeedsPollen(query) && this.shouldRefreshPollen();

    // Return cached if nothing needs refresh
    if (!needsGeocoding && !needsWeather && !needsAirQuality && !needsPollen && this.cachedContext) {
      console.log(`📦 Using cached location context for ${this.user.userId}`);
      return this.cachedContext;
    }

    // Initialize or update context
    if (!this.cachedContext || needsGeocoding) {
      await this.refreshGeocoding(lat, lng);
    }

    // Fetch optional data in parallel
    const fetches: Promise<void>[] = [];
    if (needsWeather && this.cachedContext) fetches.push(this.refreshWeather(lat, lng));
    if (needsAirQuality && this.cachedContext) fetches.push(this.refreshAirQuality(lat, lng));
    if (needsPollen && this.cachedContext) fetches.push(this.refreshPollen(lat, lng));
    if (fetches.length > 0) await Promise.all(fetches);

    return this.cachedContext;
  }

  /**
   * Get cached context without making API calls
   */
  getCachedContext(): LocationContext | null {
    return this.cachedContext;
  }

  /**
   * Get the user's timezone (available even before location context is built)
   */
  getTimezone(): string | null {
    return this.cachedContext?.timezone ?? this.userTimezone;
  }

  /**
   * Check if geocoding should be refreshed
   */
  private shouldRefreshGeocoding(lat: number, lng: number): boolean {
    if (!this.cachedContext || this.lastGeocodedLat === null) {
      return true;
    }

    const now = Date.now();
    const cacheAge = now - this.cachedContext.geocodedAt;
    if (cacheAge > LOCATION_CACHE_SETTINGS.geocodeCacheDurationMs) {
      return true;
    }

    // Check if location moved significantly
    const latDiff = Math.abs(lat - this.lastGeocodedLat!);
    const lngDiff = Math.abs(lng - this.lastGeocodedLng!);
    if (latDiff > LOCATION_CACHE_SETTINGS.minMovementDegrees ||
        lngDiff > LOCATION_CACHE_SETTINGS.minMovementDegrees) {
      return true;
    }

    return false;
  }

  /**
   * Check if weather should be refreshed
   */
  private shouldRefreshWeather(): boolean {
    if (!this.cachedContext || !this.cachedContext.weather) {
      return true;
    }

    const now = Date.now();
    const cacheAge = now - this.cachedContext.weatherFetchedAt;
    return cacheAge > LOCATION_CACHE_SETTINGS.weatherCacheDurationMs;
  }

  /**
   * Check if air quality should be refreshed
   */
  private shouldRefreshAirQuality(): boolean {
    if (!this.cachedContext || !this.cachedContext.airQuality) return true;
    const cacheAge = Date.now() - this.cachedContext.airQualityFetchedAt;
    return cacheAge > LOCATION_CACHE_SETTINGS.airQualityCacheDurationMs;
  }

  /**
   * Check if pollen should be refreshed
   */
  private shouldRefreshPollen(): boolean {
    if (!this.cachedContext || !this.cachedContext.pollen) return true;
    const cacheAge = Date.now() - this.cachedContext.pollenFetchedAt;
    return cacheAge > LOCATION_CACHE_SETTINGS.pollenCacheDurationMs;
  }

  /**
   * Refresh geocoding data from Google Maps API
   */
  private async refreshGeocoding(lat: number, lng: number): Promise<void> {
    if (!this.googleApiKey) {
      console.warn('⚠️ Google Cloud API key not configured');
      this.initializeContextWithDefaults(lat, lng);
      return;
    }

    console.log(`🌐 Fetching geocoding for ${lat}, ${lng}`);

    try {
      const response = await mapsClient.reverseGeocode({
        params: {
          latlng: { lat, lng },
          key: this.googleApiKey!,
        },
        timeout: 5000,
      });

      if (response.data.status !== 'OK' || !response.data.results?.length) {
        const status = response.data.status;
        if (status === 'REQUEST_DENIED' || status === 'OVER_QUERY_LIMIT') {
          this._lastApiError = {
            kind: status === 'OVER_QUERY_LIMIT' ? 'quota_exceeded' : 'permission_denied',
            api: 'Geocoding',
            status: 0,
            message: `Geocoding status: ${status}`,
            userMessage: status === 'OVER_QUERY_LIMIT'
              ? 'Your Google Cloud Geocoding API has reached its usage limit. You may need to check your Google Cloud billing or quota settings.'
              : 'The Google Cloud Geocoding API access was denied. Please check your API key permissions.',
          };
          console.warn(`⚠️ Geocoding failed: ${status} — ${this._lastApiError.kind}`);
        } else {
          console.warn(`⚠️ Geocoding failed: ${status}`);
        }
        this.initializeContextWithDefaults(lat, lng);
        return;
      }

      const result = response.data.results[0];
      const components = result.address_components;

      // Parse address components
      let streetNumber = '';
      let route = '';
      let neighborhood = '';
      let city = 'Unknown';
      let state = 'Unknown';
      let country = 'Unknown';

      for (const component of components) {
        const types = component.types as string[];

        if (types.includes('street_number')) {
          streetNumber = component.long_name;
        } else if (types.includes('route')) {
          route = component.long_name;
        } else if (types.includes('neighborhood') || types.includes('sublocality')) {
          neighborhood = component.long_name;
        } else if (types.includes('locality')) {
          city = component.long_name;
        } else if (types.includes('administrative_area_level_1')) {
          state = component.long_name;
        } else if (types.includes('country')) {
          country = component.long_name;
        }
      }

      const streetAddress = [streetNumber, route].filter(Boolean).join(' ') || undefined;

      // Update or create context
      const now = Date.now();
      this.cachedContext = {
        lat,
        lng,
        city,
        state,
        country,
        streetAddress,
        neighborhood: neighborhood || undefined,
        geocodedAt: now,
        weatherFetchedAt: this.cachedContext?.weatherFetchedAt || 0,
        airQualityFetchedAt: this.cachedContext?.airQualityFetchedAt || 0,
        pollenFetchedAt: this.cachedContext?.pollenFetchedAt || 0,
        weather: this.cachedContext?.weather,
        airQuality: this.cachedContext?.airQuality,
        pollen: this.cachedContext?.pollen,
      };

      this.lastGeocodedLat = lat;
      this.lastGeocodedLng = lng;
      this._lastApiError = null; // Clear on success

      console.log(`✅ Geocoding complete: ${city}, ${state}`);

    } catch (error) {
      this._lastApiError = classifyThrownGoogleError(error, "Geocoding");
      console.error('❌ Geocoding error:', this._lastApiError.message);
      this.initializeContextWithDefaults(lat, lng);
    }
  }

  /**
   * Refresh weather data from Google Weather API
   */
  private async refreshWeather(lat: number, lng: number): Promise<void> {
    if (!this.googleApiKey || !this.cachedContext) return;

    console.log(`🌤️ Fetching weather for ${lat}, ${lng}`);

    try {
      const url = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${this.googleApiKey}&location.latitude=${lat}&location.longitude=${lng}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        this._lastApiError = await classifyGoogleCloudError(response, "Weather");
        console.warn(`⚠️ Weather API error: ${response.status} — ${this._lastApiError.kind}: ${this._lastApiError.message}`);
        return;
      }

      const data = await response.json();

      const tempCelsius = Math.round(data.temperature?.degrees ?? 0);
      const tempFahrenheit = Math.round(tempCelsius * 9 / 5 + 32);
      const condition = data.condition?.description || 'Unknown';
      const humidity = data.humidity;
      const windSpeed = data.wind?.speed?.value ? Math.round(data.wind.speed.value * 2.237) : undefined;
      const windDir = data.wind?.direction?.degrees ? this.getWindDirection(data.wind.direction.degrees) : undefined;

      this.cachedContext.weather = {
        temperature: tempFahrenheit,
        temperatureCelsius: tempCelsius,
        condition,
        humidity,
        wind: windSpeed && windDir ? `${windSpeed} mph ${windDir}` : undefined,
      };
      this.cachedContext.weatherFetchedAt = Date.now();
      this._lastApiError = null; // Clear on success

      console.log(`✅ Weather: ${tempFahrenheit}°F, ${condition}`);

    } catch (error) {
      this._lastApiError = classifyThrownGoogleError(error, "Weather");
      console.error('❌ Weather error:', this._lastApiError.message);
    }
  }

  /**
   * Refresh air quality data from Google Air Quality API
   */
  private async refreshAirQuality(lat: number, lng: number): Promise<void> {
    if (!this.googleApiKey || !this.cachedContext) return;

    console.log(`🌬️ Fetching air quality for ${lat}, ${lng}`);

    try {
      const response = await fetch(
        `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${this.googleApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: { latitude: lat, longitude: lng },
          }),
        }
      );

      if (!response.ok) {
        this._lastApiError = await classifyGoogleCloudError(response, "Air Quality");
        console.warn(`⚠️ Air Quality API error: ${response.status} — ${this._lastApiError.kind}: ${this._lastApiError.message}`);
        return;
      }

      const data = await response.json();
      const index = data.indexes?.find((i: any) => i.code === "uaqi");

      if (index) {
        this.cachedContext.airQuality = {
          aqi: index.aqi,
          category: index.category || "Unknown",
          dominantPollutant: index.dominantPollutant || "unknown",
        };
        this.cachedContext.airQualityFetchedAt = Date.now();
        this._lastApiError = null;
        console.log(`✅ Air Quality: AQI ${index.aqi} — ${index.category}`);
      }
    } catch (error) {
      this._lastApiError = classifyThrownGoogleError(error, "Air Quality");
      console.error("❌ Air Quality error:", this._lastApiError.message);
    }
  }

  /**
   * Refresh pollen data from Google Pollen API
   */
  private async refreshPollen(lat: number, lng: number): Promise<void> {
    if (!this.googleApiKey || !this.cachedContext) return;

    console.log(`🌿 Fetching pollen data for ${lat}, ${lng}`);

    try {
      const url = `https://pollen.googleapis.com/v1/forecast:lookup?key=${this.googleApiKey}&location.latitude=${lat}&location.longitude=${lng}&days=1`;
      const response = await fetch(url);

      if (!response.ok) {
        this._lastApiError = await classifyGoogleCloudError(response, "Pollen");
        console.warn(`⚠️ Pollen API error: ${response.status} — ${this._lastApiError.kind}: ${this._lastApiError.message}`);
        return;
      }

      const data = await response.json();
      const today = data.dailyInfo?.[0];

      if (today?.pollenTypeInfo) {
        const getType = (code: string) => {
          const info = today.pollenTypeInfo.find((p: any) => p.code === code);
          if (!info?.indexInfo) return null;
          return { level: info.indexInfo.category || "Unknown", value: info.indexInfo.value || 0 };
        };

        this.cachedContext.pollen = {
          grass: getType("GRASS"),
          tree: getType("TREE"),
          weed: getType("WEED"),
        };
        this.cachedContext.pollenFetchedAt = Date.now();
        this._lastApiError = null;

        const levels = [
          this.cachedContext.pollen.grass ? `Grass: ${this.cachedContext.pollen.grass.level}` : null,
          this.cachedContext.pollen.tree ? `Tree: ${this.cachedContext.pollen.tree.level}` : null,
          this.cachedContext.pollen.weed ? `Weed: ${this.cachedContext.pollen.weed.level}` : null,
        ].filter(Boolean).join(", ");
        console.log(`✅ Pollen: ${levels}`);
      }
    } catch (error) {
      this._lastApiError = classifyThrownGoogleError(error, "Pollen");
      console.error("❌ Pollen error:", this._lastApiError.message);
    }
  }

  /**
   * Initialize context with default values
   */
  private initializeContextWithDefaults(lat: number, lng: number): void {
    const now = Date.now();
    this.cachedContext = {
      lat,
      lng,
      city: 'Unknown',
      state: 'Unknown',
      country: 'Unknown',
      geocodedAt: now,
      weatherFetchedAt: 0,
      airQualityFetchedAt: 0,
      pollenFetchedAt: 0,
    };
    this.lastGeocodedLat = lat;
    this.lastGeocodedLng = lng;
  }

  /**
   * Convert wind direction degrees to cardinal direction
   */
  private getWindDirection(degrees: number): string {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(degrees / 22.5) % 16;
    return directions[index];
  }

  /**
   * Set timezone (called from SDK settings or auto-detected from GPS)
   */
  setTimezone(timezone: string): void {
    this.userTimezone = timezone;
    if (this.cachedContext) {
      this.cachedContext.timezone = timezone;
    }
  }

  /**
   * Fetch timezone from coordinates using Google Maps Timezone API.
   * Used as fallback when MentraOS doesn't provide userTimezone.
   */
  private async fetchTimezoneFromCoordinates(lat: number, lng: number): Promise<string | null> {
    if (!this.googleApiKey) return null;

    try {
      const response = await mapsClient.timezone({
        params: {
          location: { lat, lng },
          timestamp: Math.floor(Date.now() / 1000),
          key: this.googleApiKey,
        },
        timeout: 5000,
      });

      if (response.data.status === 'OK' && response.data.timeZoneId) {
        return response.data.timeZoneId;
      }
      console.warn(`⚠️ Timezone API returned: ${response.data.status}`);
      return null;
    } catch (error) {
      console.warn('⚠️ Timezone lookup from GPS failed:', error);
      return null;
    }
  }

  /**
   * Clean up (called on session end)
   */
  destroy(): void {
    this.cachedContext = null;
    this.currentLat = null;
    this.currentLng = null;
    this.lastGeocodedLat = null;
    this.lastGeocodedLng = null;
    this._lastApiError = null;
    console.log(`🗑️ LocationManager cleaned up for ${this.user.userId}`);
  }
}
