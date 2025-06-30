import { watch, type FSWatcher } from "node:fs";

/**
 * FileWatcher class for monitoring JSON database files and distinguishing
 * between internal writes (initiated by the application) and external changes
 * (manual edits by users).
 */
export class FileWatcher {
	private watchers = new Map<string, FSWatcher>();
	private writeTracking = new Map<string, number>();
	private debounceTimers = new Map<string, NodeJS.Timeout>();
	
	// Time window to consider a change as internal after trackWrite() call
	private readonly WRITE_TRACKING_WINDOW = 1000; // 1 second
	// Debounce delay to handle rapid successive file changes
	private readonly DEBOUNCE_DELAY = 500; // 500ms

	/**
	 * Start watching a file for changes.
	 * @param filePath - Absolute path to the file to watch
	 * @param onChange - Callback function called when external changes are detected
	 */
	watchFile(filePath: string, onChange: (filePath: string) => void): void {
		// Clean up existing watcher if any
		this.stopWatching(filePath);

		try {
			const watcher = watch(filePath, (eventType) => {
				// Only handle 'change' events, ignore 'rename' for now
				if (eventType !== 'change') return;

				// Clear any existing debounce timer
				const existingTimer = this.debounceTimers.get(filePath);
				if (existingTimer) {
					clearTimeout(existingTimer);
				}

				// Set new debounce timer
				const timer = setTimeout(() => {
					this.debounceTimers.delete(filePath);
					
					// Check if this was an external change
					if (this.isExternalChange(filePath)) {
						console.log(`📁 External file change detected: ${filePath}`);
						onChange(filePath);
					} else {
						console.log(`📁 Internal file write detected (ignoring): ${filePath}`);
					}
				}, this.DEBOUNCE_DELAY);

				this.debounceTimers.set(filePath, timer);
			});

			// Handle watcher errors
			watcher.on('error', (error) => {
				console.error(`FileWatcher error for ${filePath}:`, error);
				// Clean up on error
				this.stopWatching(filePath);
			});

			this.watchers.set(filePath, watcher);
			console.log(`📁 Started watching file: ${filePath}`);
		} catch (error) {
			console.error(`Failed to start watching ${filePath}:`, error);
		}
	}

	/**
	 * Track a write operation initiated by the application.
	 * This helps distinguish internal writes from external changes.
	 * @param filePath - Path of the file being written to
	 */
	trackWrite(filePath: string): void {
		const timestamp = Date.now();
		this.writeTracking.set(filePath, timestamp);

		// Clean up the tracking entry after the tracking window
		setTimeout(() => {
			const currentTimestamp = this.writeTracking.get(filePath);
			// Only clear if this is the same timestamp (no newer writes)
			if (currentTimestamp === timestamp) {
				this.writeTracking.delete(filePath);
			}
		}, this.WRITE_TRACKING_WINDOW);
	}

	/**
	 * Check if a file change is external (not initiated by the application).
	 * @param filePath - Path of the changed file
	 * @returns true if the change is external, false if it was an internal write
	 */
	private isExternalChange(filePath: string): boolean {
		const lastWriteTime = this.writeTracking.get(filePath);
		if (!lastWriteTime) {
			// No recent write tracking, so this is external
			return true;
		}

		const timeSinceWrite = Date.now() - lastWriteTime;
		// If the change happened within the tracking window, it's likely internal
		return timeSinceWrite > this.WRITE_TRACKING_WINDOW;
	}

	/**
	 * Stop watching a specific file.
	 * @param filePath - Path of the file to stop watching
	 */
	stopWatching(filePath: string): void {
		const watcher = this.watchers.get(filePath);
		if (watcher) {
			watcher.close();
			this.watchers.delete(filePath);
			console.log(`📁 Stopped watching file: ${filePath}`);
		}

		// Clean up debounce timer
		const timer = this.debounceTimers.get(filePath);
		if (timer) {
			clearTimeout(timer);
			this.debounceTimers.delete(filePath);
		}

		// Clean up write tracking
		this.writeTracking.delete(filePath);
	}

	/**
	 * Stop watching all files and clean up resources.
	 */
	stopAll(): void {
		for (const filePath of this.watchers.keys()) {
			this.stopWatching(filePath);
		}
	}

	/**
	 * Get the list of currently watched files.
	 * @returns Array of file paths being watched
	 */
	getWatchedFiles(): string[] {
		return Array.from(this.watchers.keys());
	}
}