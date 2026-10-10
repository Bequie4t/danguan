import assert from "node:assert/strict";

// Web Locks queue model. No browser/network or real tokens are used.
export function queuedLocks(): LockManager {
  const active = new Set<string>();
  const queues = new Map<string, Array<() => void>>();
  return { request: (name: string, options: LockOptions, work: (lock: Lock | null) => unknown) => new Promise((resolve, reject) => {
    assert.equal(options.steal, undefined);
    if (options.ifAvailable && active.has(name)) { Promise.resolve().then(() => work(null)).then(resolve, reject); return; }
    let cancelled = false;
    const abort = () => { cancelled = true; reject(new DOMException("aborted", "AbortError")); };
    options.signal?.addEventListener("abort", abort, { once: true });
    const enter = () => {
      if (cancelled) { queues.get(name)?.shift()?.(); return; }
      options.signal?.removeEventListener("abort", abort);
      active.add(name);
      Promise.resolve().then(() => work({ name, mode: "exclusive" })).then(resolve, reject).finally(() => {
        active.delete(name);
        queues.get(name)?.shift()?.();
      });
    };
    if (active.has(name)) { const q = queues.get(name) ?? []; q.push(enter); queues.set(name, q); }
    else enter();
  }) } as unknown as LockManager;
}
