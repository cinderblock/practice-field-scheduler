/**
 * Simple FIFO mutex.
 *
 * NOT reentrant: holding code that calls another function which also tries
 * to `acquire()` will deadlock waiting for itself. Callers must release
 * before any reachable code path that re-enters. If you find yourself
 * wanting to acquire a second time, extract the inner work into a helper
 * that takes a "lock already held" flag, or factor the shared mutation
 * into a single critical section.
 */
export class Lock {
	private locked = false;
	private queue: Array<() => void> = [];

	async acquire(): Promise<() => void> {
		if (!this.locked) {
			this.locked = true;
			return () => {
				this.locked = false;
				const next = this.queue.shift();
				if (next) next();
			};
		}

		return new Promise(resolve => {
			this.queue.push(() => {
				this.locked = true;
				resolve(() => {
					this.locked = false;
					const next = this.queue.shift();
					if (next) next();
				});
			});
		});
	}
}
