/**
 * Location Query Detection
 *
 * Fast classifier to detect if a user query is location-related.
 * Used for lazy geocoding - only fetch location data when needed.
 */

// Keywords that indicate a location-related question
const LOCATION_KEYWORDS = [
  // Direct location questions
  'where am i',
  'my location',
  'location',
  'my address',
  'current location',
  'my current address',

  // City/area questions
  'what city',
  'which city',
  'what town',
  'what state',
  'what country',
  'what neighborhood',
  'what area',
  'what street',
  'which street',

  // Proximity questions
  'nearby',
  'near me',
  'around here',
  'close to me',
  'closest',
  'nearest',
  'in this area',

  // Navigation/directions
  'directions to',
  'how to get to',
  'navigate to',
  'route to',
  'how far',
  'distance to',
  'walking distance',
  'driving distance',

  // Local recommendations
  'restaurants nearby',
  'coffee near',
  'food near',
  'stores near',
  'shops near',
  'places near',
  'things to do near',
  'what\'s around',
];

// Weather keywords (also need location)
const WEATHER_KEYWORDS = [
  'weather',
  'temperature',
  'forecast',
  'rain',
  'sunny',
  'cloudy',
  'snow',
  'humidity',
  'wind speed',
];

// Air quality keywords
const AIR_QUALITY_KEYWORDS = [
  'air quality',
  'aqi',
  'air pollution',
  'pollution level',
  'smog',
  'air index',
  'particulate',
  'pm2.5',
  'pm10',
];

// Time keywords (trigger GPS → timezone auto-detect)
const TIME_KEYWORDS = [
  'what time',
  'current time',
  'time is it',
  'time zone',
  'timezone',
  'what day',
  'what date',
  'day is it',
  'date is it',
];

// Pollen / allergy keywords
const POLLEN_KEYWORDS = [
  'pollen',
  'allergy',
  'allergies',
  'hay fever',
  'pollen count',
  'pollen forecast',
  'allergy forecast',
  'allergy season',
];

/**
 * Check if a query is location-related
 * @param query - The user's query text
 * @returns true if the query needs location data
 */
export function isLocationQuery(query: string): boolean {
  const q = query.toLowerCase();

  if (LOCATION_KEYWORDS.some(kw => q.includes(kw))) return true;
  if (WEATHER_KEYWORDS.some(kw => q.includes(kw))) return true;
  if (AIR_QUALITY_KEYWORDS.some(kw => q.includes(kw))) return true;
  if (POLLEN_KEYWORDS.some(kw => q.includes(kw))) return true;
  if (TIME_KEYWORDS.some(kw => q.includes(kw))) return true;

  return false;
}

/**
 * Check if query is time-related (triggers GPS → timezone auto-detect)
 */
export function isTimeQuery(query: string): boolean {
  const q = query.toLowerCase();
  return TIME_KEYWORDS.some(kw => q.includes(kw));
}

/**
 * Check if query specifically needs geocoding (street/city/neighborhood)
 * vs just weather which only needs lat/lng
 */
export function needsGeocoding(query: string): boolean {
  const q = query.toLowerCase();

  // Weather only needs lat/lng, not full geocoding
  if (WEATHER_KEYWORDS.some(kw => q.includes(kw))) {
    // Unless they're asking "weather in [city]" which doesn't need our location
    if (!q.includes(' in ') && !q.includes(' at ')) {
      return false; // Just weather at current location - lat/lng is enough
    }
  }

  // Air quality and pollen only need lat/lng
  if (AIR_QUALITY_KEYWORDS.some(kw => q.includes(kw))) return false;
  if (POLLEN_KEYWORDS.some(kw => q.includes(kw))) return false;

  // All other location queries need geocoding
  return LOCATION_KEYWORDS.some(kw => q.includes(kw));
}

/**
 * Check if query is weather-related
 */
export function isWeatherQuery(query: string): boolean {
  const q = query.toLowerCase();
  return WEATHER_KEYWORDS.some(kw => q.includes(kw));
}

/**
 * Check if query is air-quality-related
 */
export function isAirQualityQuery(query: string): boolean {
  const q = query.toLowerCase();
  return AIR_QUALITY_KEYWORDS.some(kw => q.includes(kw));
}

/**
 * Check if query is pollen/allergy-related
 */
export function isPollenQuery(query: string): boolean {
  const q = query.toLowerCase();
  return POLLEN_KEYWORDS.some(kw => q.includes(kw));
}

/**
 * Get the type of location query for logging/debugging
 */
export function getLocationQueryType(query: string): 'none' | 'weather_only' | 'air_quality' | 'pollen' | 'time' | 'full_location' {
  const q = query.toLowerCase();

  if (LOCATION_KEYWORDS.some(kw => q.includes(kw))) return 'full_location';
  if (WEATHER_KEYWORDS.some(kw => q.includes(kw))) return 'weather_only';
  if (AIR_QUALITY_KEYWORDS.some(kw => q.includes(kw))) return 'air_quality';
  if (POLLEN_KEYWORDS.some(kw => q.includes(kw))) return 'pollen';
  if (TIME_KEYWORDS.some(kw => q.includes(kw))) return 'time';

  return 'none';
}
