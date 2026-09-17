export class WorkerRpc {
  private counter = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;
  constructor(private worker: Worker) {
    worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(data.id);
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data);
    };
    worker.onerror = () => this.dispose(new Error('Scanner worker failed. Check the asset URL, MIME type and CSP.'));
    worker.onmessageerror = () => this.dispose(new Error('Scanner worker returned unreadable data.'));
  }
  request<T>(message: object, transfer: Transferable[] = [], timeout = 15000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Scanner engine is closed'));
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose(new Error('Scanner worker timed out')), timeout);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.worker.postMessage({ ...message, id }, transfer); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  dispose(error = new Error('Scanner engine is closed')) {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }
}
