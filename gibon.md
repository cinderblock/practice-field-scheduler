# Practice Field Reservation System - Developer Guide

## Project Overview

This is a **Practice Field Reservation System** built with the T3 Stack (Next.js, tRPC, NextAuth.js). It enables sports teams to schedule and manage practice field reservations through a web interface with Slack OAuth authentication.

### Key Features
- **Field Reservations**: Teams can book practice time slots on specific dates
- **Blackout Management**: Admins can block dates/times when fields are unavailable
- **Site Events**: Track field-wide events that affect availability
- **User Management**: Role-based access control (admin vs team members)
- **Calendar Feeds**: Public iCalendar (ICS) exports for integration with calendar apps
- **Real-time Updates**: WebSocket notifications for reservation changes
- **Slack Integration**: OAuth authentication through Slack workspace

## Architecture

### High-Level Architecture
- **Frontend**: Next.js 15 with React 19, TypeScript, and CSS modules
- **Backend**: Next.js API routes with tRPC for type-safe API calls
- **Authentication**: NextAuth.js with Slack OAuth provider
- **Data Storage**: JSON files in filesystem (no traditional database)
- **Real-time**: WebSocket connections for live updates
- **Calendar Integration**: iCalendar (ICS) feed generation

### Core Components
1. **Backend Logic** (`src/server/backend.ts`) - Main business logic and data management
2. **tRPC API** (`src/server/api/`) - Type-safe API layer
3. **Authentication** (`src/server/auth/`) - NextAuth.js configuration
4. **Frontend Components** (`src/app/_components/`) - React UI components
5. **Data Files** (`data/`) - JSON storage for all application data

## Directory Structure

```
├── src/
│   ├── app/                     # Next.js App Router pages and components
│   │   ├── _components/         # Shared React components
│   │   ├── api/                 # API route handlers
│   │   │   ├── auth/            # NextAuth.js endpoints
│   │   │   ├── calendar/        # iCalendar feed endpoints
│   │   │   └── trpc/            # tRPC API handler
│   │   ├── logs/                # Admin logs page
│   │   ├── users/               # User management page
│   │   ├── layout.tsx           # Root layout component
│   │   └── page.tsx             # Homepage with reservation calendar
│   ├── server/
│   │   ├── api/                 # tRPC API definitions
│   │   │   ├── routers/         # API route handlers
│   │   │   ├── root.ts          # Root tRPC router
│   │   │   └── trpc.ts          # tRPC configuration
│   │   ├── auth/                # Authentication configuration
│   │   ├── util/                # Server utilities
│   │   │   ├── JsonData.ts      # JSON data type definitions
│   │   │   ├── Lock.ts          # Concurrency control
│   │   │   ├── exit.ts          # Process exit helper
│   │   │   └── timeUtils.ts     # Date/time utilities
│   │   ├── backend.ts           # Main backend logic and data management
│   │   ├── calendarFeed.ts      # iCalendar generation
│   │   ├── teamLogoManager.ts   # Team logo handling
│   │   └── websocket.ts         # WebSocket notifications
│   ├── trpc/                    # tRPC client configuration
│   ├── styles/                  # Global styles
│   ├── env.js                   # Environment variable validation
│   └── types.ts                 # TypeScript type definitions
├── data/                        # JSON data storage
│   ├── {YEAR}/                  # Year-specific data
│   │   ├── reservations.json    # Reservation records
│   │   ├── blackouts.json       # Blackout periods
│   │   ├── events.json          # Site events
│   │   ├── teams.json           # Team definitions
│   │   └── logs.txt             # Activity logs
│   ├── users.json               # User accounts (persistent across years)
│   └── slack.json               # Slack ID mappings
├── test/                        # Test files
│   ├── unit/                    # Unit tests (Vitest)
│   └── e2e/                     # End-to-end tests (Playwright)
├── public/                      # Static assets
└── deploy/                      # Deployment configuration
```

## Key Files

### Backend Core (`src/server/backend.ts`)
- **Primary database abstraction layer** - All data operations go through this file
- **In-memory data storage** with JSON file persistence
- **Global state management** using `globalThis` for HMR persistence
- **Concurrency control** using custom Lock implementation
- **Context class** for user session management and permissions
- **File I/O operations** for reading/writing JSON data files

### Data Types (`src/types.ts`)
- **Reservation**: Core booking entity with date, time slot, team, and metadata
- **Blackout**: Admin-defined unavailable periods
- **SiteEvent**: Field-wide events affecting availability
- **UserEntry**: User account with team memberships and permissions
- **EventDate**: String format (YYYY-MM-DD)
- **TimeSlot**: String format (HH:mm)

### tRPC API (`src/server/api/`)
- **Type-safe API layer** connecting frontend to backend
- **Router-based organization** for different feature areas
- **Built-in input validation** using Zod schemas
- **Context injection** for user authentication and IP tracking

### Environment Configuration (`src/env.js`)
- **Strict environment variable validation** using Zod schemas
- **Server-side variables**: Auth secrets, API tokens, data directory
- **Client-side variables**: Time zones, calendar configuration, UI settings

## Database System (JSON Files)

### File-Based Storage
The application uses JSON files instead of a traditional database:

```javascript
// Data file locations (from backend.ts)
const DATA_DIR = resolve(env.DATA_DIR);
const YEAR = new Date().getFullYear().toString();

// Persistent across years
const USERS_FILE = join(DATA_DIR, "users.json");
const SLACK_MAPPINGS_FILE = join(DATA_DIR, "slack.json");

// Year-specific
const RESERVATIONS_FILE = join(DATA_DIR, YEAR, "reservations.json");
const BLACKOUTS_FILE = join(DATA_DIR, YEAR, "blackouts.json");
const SITE_EVENTS_FILE = join(DATA_DIR, YEAR, "events.json");
const HOUSE_TEAMS_FILE = join(DATA_DIR, YEAR, "teams.json");
const LOGS_FILE = join(DATA_DIR, YEAR, "logs.txt");
```

### Data Flow
1. **Initialization**: JSON files are read into in-memory arrays on startup
2. **Operations**: All CRUD operations work on in-memory data
3. **Persistence**: Changes are written back to JSON files asynchronously
4. **Concurrency**: Custom Lock class prevents race conditions
5. **Year Boundary**: Process automatically restarts at year change

### Key Arrays (Global State)
```javascript
// Global in-memory storage arrays
globalThis.__reservations     // Reservation[]
globalThis.__blackouts        // Blackout[]
globalThis.__siteEvents       // SiteEvent[]
globalThis.__users            // UserEntry[]
globalThis.__houseTeams       // Team[]
globalThis.__slackMappings    // SlackMapping[]
```

## Coding Conventions

### File Organization
- **Server-side code**: `src/server/` directory
- **Client-side code**: `src/app/` directory (App Router)
- **Shared types**: `src/types.ts`
- **Utilities**: Grouped by domain in `util/` directories

### TypeScript Patterns
- **Strict TypeScript** configuration with `noUncheckedIndexedAccess`
- **Type-safe environment variables** using `@t3-oss/env-nextjs`
- **Zod schemas** for runtime validation of external data
- **Branded types** for IDs and domain-specific strings

### Naming Conventions
- **Files**: kebab-case for components, camelCase for utilities
- **Types**: PascalCase with descriptive suffixes (e.g., `UserEntry`, `AddReservationArgs`)
- **Functions**: camelCase with clear verb-noun patterns
- **Constants**: SCREAMING_SNAKE_CASE for file paths and configuration

### Error Handling
- **Custom error types**: `PermissionError` for authorization failures
- **Async error handling**: Use `.catch()` for non-critical operations
- **Graceful degradation**: `ContinueOnError` flag for resilient operation

### State Management
- **Server state**: Global arrays with file persistence
- **HMR persistence**: Use `globalThis` to survive hot reloads
- **Concurrency**: Lock-based coordination for data modifications

## Dependencies

### Core Dependencies
- **Next.js 15**: React framework with App Router
- **React 19**: UI library with latest features
- **NextAuth.js 5**: Authentication with Slack OAuth
- **tRPC 11**: Type-safe API layer
- **TanStack React Query**: Server state management
- **Zod**: Runtime schema validation
- **@t3-oss/env-nextjs**: Environment variable validation

### Utility Dependencies
- **date-fns**: Date manipulation and formatting
- **ical-generator**: iCalendar feed generation
- **first-events-api**: Team logo integration
- **superjson**: Enhanced JSON serialization

### Development Dependencies
- **TypeScript 5**: Static type checking
- **Biome**: Code linting and formatting
- **Prettier**: Code formatting
- **Vitest**: Unit testing framework
- **Playwright**: End-to-end testing
- **@vitest/coverage-v8**: Test coverage reporting

## Development Workflow

### Setup
```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your configuration

# Generate auth secret
npx auth secret --raw
```

### Development Server
```bash
# Start development server with Turbo
npm run dev

# Open http://localhost:3000
```

### HTTPS for Slack OAuth
Slack requires HTTPS for OAuth redirects. Use one of:
```bash
# Option 1: ngrok
ngrok http 3000

# Option 2: Cloudflare tunnel
cloudflared tunnel --url http://localhost:3000
```

### Code Quality
```bash
# Run all checks
npm run check

# Auto-fix issues
npm run check:write

# Unsafe fixes (use with caution)
npm run check:unsafe
```

### Testing
```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# E2E tests only
npm run test:e2e

# Type checking
npm run typecheck
```

### Build and Deploy
```bash
# Build production bundle
npm run build

# Start production server
npm run start

# Preview build locally
npm run preview
```

## Common Tasks

### Adding a New Data Type
1. **Define type** in `src/types.ts`
2. **Add to backend.ts**:
   - Create global array variable
   - Add file path constant
   - Implement CRUD methods in Context class
   - Add to initialization logic
3. **Create tRPC router** in `src/server/api/routers/`
4. **Add frontend components** for UI interaction

### Modifying User Permissions
- **Admin check**: `await this.isAdmin()` in Context methods
- **Team restriction**: `this.restrictToTeam(team, message)`
- **Time restrictions**: `this.restrictTimeframe(date)` for booking windows

### Adding New API Endpoints
1. **Define input/output types** in appropriate types file
2. **Create tRPC procedure** in relevant router
3. **Implement backend logic** in Context class
4. **Add frontend hooks** using tRPC React Query integration

### Integrating External APIs
- **Environment variables**: Add to `src/env.js` schema
- **Server-side calls**: Use in API routes or server components
- **Client-side calls**: Use Next.js API routes as proxy

### Database Schema Changes
1. **Update types** in `src/types.ts`
2. **Modify initialization logic** in `backend.ts`
3. **Handle migration** of existing JSON files
4. **Update related UI components**

## Important Context

### File-Based Database Considerations
- **No SQL queries**: All operations are JavaScript array methods
- **Memory usage**: All data is kept in memory (suitable for small datasets)
- **Backup**: JSON files can be easily backed up and version controlled
- **Concurrency**: Single-process design with locking for thread safety

### Year Boundary Handling
- The system automatically shuts down at year changes to prevent data corruption
- Year-specific data is stored in separate directories (e.g., `data/2025/`)
- Systemd or similar process manager should restart the application

### HMR (Hot Module Reload) Persistence
- Uses `globalThis` to maintain state across development reloads
- Module instance ID tracking prevents stale state issues
- Lock instances are persisted to avoid deadlocks

### Security Considerations
- **Authentication required**: All API operations require valid session
- **Team-based authorization**: Users can only modify their team's reservations
- **Admin privileges**: Certain operations (blackouts, site events) require admin role
- **IP logging**: All operations are logged with user IP and user agent

### Performance Notes
- **In-memory operations**: Very fast for typical usage (hundreds of reservations)
- **File I/O is async**: Write operations don't block main thread
- **WebSocket notifications**: Real-time updates for connected clients
- **JSON parsing**: Happens only on startup and file changes

### Deployment Considerations
- **Data directory**: Must be writable by the application process
- **File permissions**: Ensure proper permissions for JSON data files
- **Process management**: Use systemd or PM2 for automatic restarts
- **SSL/TLS**: Required for Slack OAuth (use reverse proxy like nginx)

### Known Limitations
- **Single process**: No horizontal scaling without external coordination
- **File locking**: Concurrent processes would need file-level locking
- **Memory growth**: Large datasets may require database migration
- **Year transitions**: Manual process restart required at year boundary

This documentation provides the essential context for AI coding assistants to understand and work effectively with this Practice Field Reservation System codebase.