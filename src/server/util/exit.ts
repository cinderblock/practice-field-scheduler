export function exit(code: number) {
	process.exitCode = code;

	setTimeout(() => {
		console.error("Forcing exit due to timeout.");
		process.exit(code);
	}, 1000).unref(); // 1 second timeout
}
