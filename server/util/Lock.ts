import { DeferredPromise } from "./DeferredPromise.js";

export class Lock {
  private change: Promise<void> | undefined;

  async acquire() {
    while (this.change) await this.change;

    const def = new DeferredPromise();
    this.change = def;

    return () => {
      this.change = undefined;
      def.resolve();
    };
  }
}
