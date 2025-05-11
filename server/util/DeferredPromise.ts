export class DeferredPromise<T = void> extends Promise<T> {
  public resolve!: (value: T | PromiseLike<T>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public reject!: (reason?: any) => void;

  constructor() {
    let resolveFn: (value: T | PromiseLike<T>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rejectFn: (reason?: any) => void;

    super((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    this.resolve = resolveFn!;
    this.reject = rejectFn!;
  }
}
