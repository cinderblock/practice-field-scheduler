"use client";

// Change this to your desired timezone
// Example values: "America/New_York", "Europe/London", "Asia/Tokyo"
export const FIXED_TIMEZONE = "America/New_York";

/**
 * Formats a date for display in the fixed timezone
 */
export function formatInFixedTimezone(
  date: Date, 
  options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit'
  }
): string {
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: FIXED_TIMEZONE
  }).format(date);
}

/**
 * Formats time for display in the fixed timezone (e.g., "3:30pm")
 */
export function formatTimeInFixedTimezone(date: Date): string {
  return formatInFixedTimezone(date, {
    hour: '2-digit',
    minute: '2-digit'
  })
  .replace(" AM", "am")
  .replace(" PM", "pm")
  .replace(" ", "\u00A0"); // non-breaking space
}

/**
 * Formats date for display in the fixed timezone (e.g., "5/18/2025")
 */
export function formatDateInFixedTimezone(date: Date): string {
  return formatInFixedTimezone(date, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
}

/**
 * Gets weekday in the fixed timezone (e.g., "Monday")
 */
export function getWeekdayInFixedTimezone(
  date: Date, 
  options: Intl.DateTimeFormatOptions = { weekday: "long" }
): string {
  return formatInFixedTimezone(date, options);
}

/**
 * Gets the day of week (0-6, where 0 is Sunday) in the fixed timezone
 */
export function getDayOfWeekInFixedTimezone(date: Date): number {
  // Use the date parts from formatToParts to figure out the day of week
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: FIXED_TIMEZONE
  }).formatToParts(date);
  
  const weekday = parts.find(part => part.type === 'weekday')?.value || '';
  
  // Map the weekday string to a number (0-6)
  const weekdayMap: {[key: string]: number} = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
  };
  
  return weekdayMap[weekday] ?? new Date(date).getDay(); // Fallback to local day
}

/**
 * Get ISO date string in the fixed timezone (YYYY-MM-DD format)
 */
export function toISOStringInFixedTimezone(date: Date): string {
  return formatInFixedTimezone(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2');
}

/**
 * Compare if two dates are the same day in the fixed timezone
 */
export function isSameDayInFixedTimezone(date1: Date, date2: Date): boolean {
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: FIXED_TIMEZONE
  });
  
  return formatter.format(date1) === formatter.format(date2);
}

/**
 * Get hours in the fixed timezone (0-23)
 */
export function getHoursInFixedTimezone(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: FIXED_TIMEZONE
  }).formatToParts(date);
  
  const hour = parts.find(part => part.type === 'hour')?.value;
  return hour ? parseInt(hour) : 0;
}

/**
 * Creates a date with the specified hours/minutes in the fixed timezone
 * This modifies the input date
 */
export function setTimeInFixedTimezone(
  date: Date, 
  hours: number, 
  minutes: number = 0
): Date {
  // First get current date in fixed timezone format
  const currentParts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: FIXED_TIMEZONE
  }).formatToParts(date);
  
  // Extract current date components
  const month = currentParts.find(p => p.type === 'month')?.value || '1';
  const day = currentParts.find(p => p.type === 'day')?.value || '1';
  const year = currentParts.find(p => p.type === 'year')?.value || '2025';
  
  // Create a date string in the target timezone with the desired hours
  const dateTimeString = `${month}/${day}/${year} ${hours}:${minutes}:00`;
  
  // Parse this string as if it were in the fixed timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', // Use UTC as an intermediate timezone
  });
  
  // Create a formatter for the fixed timezone
  const fixedFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: FIXED_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  });
  
  // Parse the target date in the fixed timezone
  const targetDate = new Date(dateTimeString);
  
  // Calculate the offset between the fixed timezone and UTC
  const fixedDate = new Date(fixedFormatter.format(targetDate));
  const utcDate = new Date(formatter.format(targetDate));
  const offset = fixedDate.getTime() - utcDate.getTime();
  
  // Adjust the date by the offset
  return new Date(targetDate.getTime() - offset);
}