# Team Avatar Caching System

This system provides caching for FIRST Robotics team avatars to reduce API calls and improve performance.

## Overview

The avatar caching system consists of:

- **Cache storage**: PNG files stored in `data/[year]/team-avatars/`
- **API endpoint**: For serving cached avatars
- **React component**: For easy UI integration

## API Endpoints

### Get Team Avatar

```
GET /api/team-avatar/[teamNumber]
```

- Returns the PNG avatar for the specified team
- Checks cache first, fetches from FIRST API if not cached
- Caches the result for future requests
- Returns 404 if team not found

**Example:**

```
GET /api/team-avatar/1234
```

## Usage in React Components

Use the provided `TeamAvatar` component:

```tsx
import { TeamAvatar } from "~/app/_components/TeamAvatar";

function MyComponent() {
	return (
		<div>
			<TeamAvatar teamNumber={1234} size={64} />
			<TeamAvatar
				teamNumber={9999}
				size={32}
				className="team-avatar-small"
				style={{ border: "1px solid #ccc", borderRadius: "50%" }}
			/>
		</div>
	);
}
```

### Component Props

- `teamNumber`: The FRC team number (required)
- `size`: Avatar size in pixels (default: 64)
- `alt`: Alt text for the image (optional)
- `className`: Additional CSS classes (optional)

## Direct Server-side Usage

Import the team logo manager:

```typescript
import { getTeamAvatar } from "~/server/teamLogoManager";

// Get avatar (from cache or API)
const avatarBuffer = await getTeamAvatar(1234);
```

## Cache Behavior

- **Cache location**: `data/[currentYear]/team-avatars/[teamNumber].png`
- **Cache persistence**: Files persist permanently (no deletion)
- **Cache miss behavior**: Fetches from FIRST API and saves to cache
- **Year-specific**: Each competition year has its own cache directory
- **Error handling**: Returns 404 for missing teams or API errors

## Year-Specific Caching

The cache is organized by competition year:

```
data/
├── 2024/
│   └── team-avatars/
│       ├── 254.png
│       └── 1678.png
├── 2025/
│   └── team-avatars/
│       ├── 254.png
│       └── 1678.png
```

This ensures that team avatars are cached separately for each year, as teams may update their avatars between seasons.

## Environment Requirements

Ensure these environment variables are set:

- `FIRST_API_USERNAME`: Your FIRST API username
- `FIRST_API_AUTH_TOKEN`: Your FIRST API auth token

## Performance Considerations

- **First request**: Slower (fetches from FIRST API)
- **Subsequent requests**: Fast (served from local cache)
- **Browser caching**: API responses include cache headers (1 day)
- **File size**: Typical avatar is 2-10 KB
- **Year isolation**: Each year's cache is independent

## Error Handling

The system gracefully handles:

- Invalid team numbers
- Teams without avatars
- FIRST API failures
- File system errors
- Network connectivity issues

Failed requests return appropriate HTTP status codes and error messages.
