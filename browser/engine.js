export class Engine {
  constructor() {
    this.nextId = 0;
    this.pending = new Map();
    this.worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          this.runtime = data;
          resolve(data);
        } else if (data.type === "load-error") {
          reject(new Error(data.error));
        } else {
          const pending = this.pending.get(data.id);
          if (!pending) return;
          this.pending.delete(data.id);
          clearTimeout(pending.timer);
          data.type === "error"
            ? pending.reject(new Error(data.error))
            : pending.resolve(data.result);
        }
      };
      this.worker.onerror = (event) =>
        reject(new Error(event.message || "WASM worker failed"));
    });
  }
  async run(payload) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "The transaction took too long to evaluate. Reload the engine before retrying.",
          ),
        );
        this.worker.terminate();
      }, 120000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, payload });
    });
  }
}
