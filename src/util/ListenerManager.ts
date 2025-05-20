import { useEffect } from "react";

export class ListenerManager<Args> {
  private listeners: ((...args: Args[]) => void)[] = [];
  private attach: () => void;
  private detach: () => void;

  constructor(attach?: () => void, detach?: () => void) {
    this.attach = () => void (this.listeners.length || attach?.());
    this.detach = () => void (this.listeners.length || detach?.());

    // Bind public methods to ensure correct context
    this.addListener = this.addListener.bind(this);
    this.notify = this.notify.bind(this);
  }

  addListener(listener: (...args: Args[]) => void) {
    this.attach();

    this.listeners.push(listener);

    return () => {
      const index = this.listeners.indexOf(listener);
      if (index === -1) return;

      this.listeners.splice(index, 1);

      this.detach();
    };
  }

  notify(...args: Args[]) {
    for (const listener of this.listeners) listener(...args);
  }

  useListener(listener: (...args: Args[]) => void) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => this.addListener(listener), [listener]);
  }
}
