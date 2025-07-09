# Weather Support Implementation

This document describes the complete weather support implementation for the Practice Field Scheduler.

## Overview

The weather support feature adds optional weather information to each time slot in the calendar, showing temperature and weather conditions from the Open-Meteo weather API.

## Configuration

### Environment Variables

Add these optional environment variables to your `.env` file:

```bash
# Weather Configuration (Optional)
WEATHER_LOCATION="San Francisco, CA"  # City name for weather data
WEATHER_API_KEY=""  # Optional API key for Open-Meteo (leave empty for free usage)
WEATHER_FETCH_FREQUENCY="96"  # How many times per day to fetch weather (default: 96 = every 15 minutes)
WEATHER_FORECAST_DAYS="10"  # Number of days to forecast (default: 10, max: 16)
```

### Weather Service

The weather service (`src/server/weatherService.ts`) handles:

- Converting city names to coordinates using Open-Meteo's geocoding API
- Fetching weather data from Open-Meteo API
- Caching weather data based on the configured fetch frequency
- Providing weather icons and descriptions based on WMO weather codes

### API Integration

Weather data is available through tRPC endpoints:

- `weather.isEnabled` - Check if weather is configured
- `weather.getForecast` - Get complete weather forecast
- `weather.getWeatherForDate` - Get weather for a specific date
- `weather.getWeatherForTimeSlot` - Get weather for a specific time slot

## User Interface

### Temperature Display

The `Temperature` component converts Celsius temperatures to Fahrenheit for display:

```tsx
<Temperature celsius={20} />  // Displays "68°F"
<Temperature celsius={25} showUnit={false} />  // Displays "77"
<Temperature celsius={21} precision={1} />  // Displays "69.8°F"
```

### Weather Display

Each time slot shows weather information when available:

- **Weather Icon**: Emoji representing current conditions (☀️ ⛅ 🌧️ ❄️ ⛈️ etc.)
- **Start Temperature**: Temperature at the beginning of the time slot
- **Middle Temperature**: Temperature in the middle (for slots > 2 hours)
- **End Temperature**: Temperature at the end of the time slot

The weather display is responsive and less prominent on mobile devices.

### Weather Icons

Weather icons are mapped from WMO weather interpretation codes:

- **0**: ☀️ Clear sky
- **1-3**: ⛅ Partly cloudy
- **45-48**: 🌫️ Fog
- **51-67**: 🌧️ Rain
- **71-77**: ❄️ Snow
- **80-82**: 🌦️ Rain showers
- **95-99**: ⛈️ Thunderstorm

## Implementation Details

### Backend

1. **Weather Service**: Handles API calls and caching
2. **tRPC Router**: Provides weather endpoints
3. **Backend Integration**: Initializes weather service on startup

### Frontend

1. **Weather Component**: Displays weather for each time slot
2. **Temperature Component**: Handles Celsius to Fahrenheit conversion
3. **Calendar Integration**: Weather is shown at the bottom of each time slot

### Error Handling

The system gracefully handles:

- Missing weather configuration (weather features are disabled)
- Network failures (cached data is used if available)
- Invalid city names (error logging, fallback to cached data)
- API rate limits (configurable fetch frequency)

## Testing

Unit tests are provided for:

- Temperature conversion logic
- Weather code to icon mapping
- API endpoint functionality

## Performance Considerations

- Weather data is cached based on the configured fetch frequency
- Cached data includes 10 days of hourly forecasts by default
- Weather display only appears when data is available
- Minimal impact on page load times

## Usage Examples

### Basic Configuration

```bash
WEATHER_LOCATION="Portland, OR"
```

This enables weather with default settings (free API usage, updates every 15 minutes, 10-day forecast).

### Advanced Configuration

```bash
WEATHER_LOCATION="New York, NY"
WEATHER_API_KEY="your-api-key-here"
WEATHER_FETCH_FREQUENCY="48"  # Update twice per day
WEATHER_FORECAST_DAYS="7"     # 7-day forecast
```

### Disabling Weather

Simply omit the `WEATHER_LOCATION` variable or leave it empty to disable weather features.

## Future Enhancements

The implementation is designed to support future enhancements:

- User-selectable temperature units (Celsius/Fahrenheit)
- More detailed weather information (humidity, wind, precipitation)
- Weather alerts and warnings
- Multiple location support
- Weather-based field availability recommendations

## Dependencies

- **openmeteo**: npm package for Open-Meteo API integration
- **Open-Meteo API**: Free weather API (no key required for basic usage)
- **Open-Meteo Geocoding API**: For converting city names to coordinates