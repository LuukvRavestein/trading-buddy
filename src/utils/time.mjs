/**
 * Time utilities
 * 
 * Helper functions for date/time manipulation in UTC.
 */

/**
 * Subtract days from an ISO timestamp string
 * 
 * @param {string} isoString - ISO timestamp (e.g., '2025-12-01T00:00:00Z')
 * @param {number} days - Number of days to subtract
 * @returns {string} ISO timestamp string in UTC with 'Z' suffix
 */
export function subtractDaysISO(isoString, days) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ISO string: ${isoString}`);
  }
  
  const resultDate = new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
  return resultDate.toISOString();
}

/**
 * Add days to an ISO timestamp string
 * 
 * @param {string} isoString - ISO timestamp (e.g., '2025-12-01T00:00:00Z')
 * @param {number} days - Number of days to add
 * @returns {string} ISO timestamp string in UTC with 'Z' suffix
 */
export function addDaysISO(isoString, days) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ISO string: ${isoString}`);
  }
  
  const resultDate = new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  return resultDate.toISOString();
}

/**
 * Add minutes to an ISO timestamp string
 * 
 * @param {string} isoString - ISO timestamp (e.g., '2025-12-01T00:00:00Z')
 * @param {number} minutes - Number of minutes to add
 * @returns {string} ISO timestamp string in UTC with 'Z' suffix
 */
export function addMinutesISO(isoString, minutes) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ISO string: ${isoString}`);
  }
  
  const resultDate = new Date(date.getTime() + minutes * 60 * 1000);
  return resultDate.toISOString();
}

/**
 * Set time to end of day (23:59:00.000Z) for a given ISO timestamp
 * 
 * @param {string} isoString - ISO timestamp (e.g., '2025-12-01T12:34:56Z')
 * @returns {string} ISO timestamp string with time set to 23:59:00.000Z
 */
export function setEndOfDayISO(isoString) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ISO string: ${isoString}`);
  }
  
  // Set to end of day: 23:59:00.000Z
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  
  const endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 0, 0));
  return endOfDay.toISOString();
}

/**
 * Normalize ISO string (ensure it's valid and has 'Z' suffix)
 * 
 * @param {string} isoString - ISO timestamp
 * @returns {string} Normalized ISO timestamp string
 */
export function normalizeISO(isoString) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ISO string: ${isoString}`);
  }
  return date.toISOString();
}

