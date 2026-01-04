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

