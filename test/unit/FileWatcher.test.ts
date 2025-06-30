import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { FileWatcher } from "../../src/server/util/FileWatcher";

describe("FileWatcher", () => {
	const testDir = join(process.cwd(), "test-tmp");
	const testFile = join(testDir, "test.json");
	let fileWatcher: FileWatcher;

	beforeAll(async () => {
		// Create test directory
		await mkdir(testDir, { recursive: true });
	});

	afterAll(async () => {
		// Clean up test directory
		await rm(testDir, { recursive: true, force: true });
	});

	beforeEach(async () => {
		fileWatcher = new FileWatcher();
		// Create test file
		await writeFile(testFile, "[]", "utf-8");
	});

	afterEach(() => {
		fileWatcher.stopAll();
	});

	it("should detect external file changes", async () => {
		const changeHandler = vi.fn();
		
		fileWatcher.watchFile(testFile, changeHandler);
		
		// Wait a bit for the watcher to be set up
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// Make an external change (not tracked)
		await writeFile(testFile, "[{}]", "utf-8");
		
		// Wait for debouncing and change detection
		await new Promise(resolve => setTimeout(resolve, 600));
		
		expect(changeHandler).toHaveBeenCalledWith(testFile);
	});

	it("should ignore internal writes when tracked", async () => {
		const changeHandler = vi.fn();
		
		fileWatcher.watchFile(testFile, changeHandler);
		
		// Wait a bit for the watcher to be set up
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// Track the write (internal)
		fileWatcher.trackWrite(testFile);
		
		// Make the write immediately after tracking
		await writeFile(testFile, "[{\"internal\": true}]", "utf-8");
		
		// Wait for debouncing and change detection
		await new Promise(resolve => setTimeout(resolve, 600));
		
		expect(changeHandler).not.toHaveBeenCalled();
	});

	it("should detect changes after tracking window expires", async () => {
		const changeHandler = vi.fn();
		
		fileWatcher.watchFile(testFile, changeHandler);
		
		// Wait a bit for the watcher to be set up
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// Track the write
		fileWatcher.trackWrite(testFile);
		
		// Wait for tracking window to expire (1000ms + buffer)
		await new Promise(resolve => setTimeout(resolve, 1200));
		
		// Make a change after tracking window expires
		await writeFile(testFile, "[{\"expired\": true}]", "utf-8");
		
		// Wait for debouncing and change detection
		await new Promise(resolve => setTimeout(resolve, 600));
		
		expect(changeHandler).toHaveBeenCalledWith(testFile);
	});

	it("should list watched files correctly", async () => {
		const testFile2 = join(testDir, "test2.json");
		
		// Create the second test file
		await writeFile(testFile2, "[]", "utf-8");
		
		expect(fileWatcher.getWatchedFiles()).toEqual([]);
		
		fileWatcher.watchFile(testFile, () => {});
		expect(fileWatcher.getWatchedFiles()).toEqual([testFile]);
		
		fileWatcher.watchFile(testFile2, () => {});
		expect(fileWatcher.getWatchedFiles()).toContain(testFile);
		expect(fileWatcher.getWatchedFiles()).toContain(testFile2);
		expect(fileWatcher.getWatchedFiles()).toHaveLength(2);
	});

	it("should stop watching specific files", () => {
		const changeHandler = vi.fn();
		
		fileWatcher.watchFile(testFile, changeHandler);
		expect(fileWatcher.getWatchedFiles()).toContain(testFile);
		
		fileWatcher.stopWatching(testFile);
		expect(fileWatcher.getWatchedFiles()).not.toContain(testFile);
	});

	it("should stop all watchers", async () => {
		const testFile2 = join(testDir, "test2.json");
		
		// Create the second test file
		await writeFile(testFile2, "[]", "utf-8");
		
		fileWatcher.watchFile(testFile, () => {});
		fileWatcher.watchFile(testFile2, () => {});
		expect(fileWatcher.getWatchedFiles()).toHaveLength(2);
		
		fileWatcher.stopAll();
		expect(fileWatcher.getWatchedFiles()).toHaveLength(0);
	});

	it("should handle non-existent files gracefully", () => {
		const nonExistentFile = join(testDir, "does-not-exist.json");
		const changeHandler = vi.fn();
		
		// Should not throw
		expect(() => {
			fileWatcher.watchFile(nonExistentFile, changeHandler);
		}).not.toThrow();
		
		// Should not be in watched files list if watching failed
		expect(fileWatcher.getWatchedFiles()).not.toContain(nonExistentFile);
	});
});