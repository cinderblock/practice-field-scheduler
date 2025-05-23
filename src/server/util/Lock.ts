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
