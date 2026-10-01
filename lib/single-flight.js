// Shares one in-flight request between concurrent callers with the same key,
// so parallel identical searches spend one Baidu quota unit instead of N.
//
// Cancellation is reference-counted: a caller whose signal aborts stops
// waiting immediately, and the shared work is aborted only once every caller
// that could cancel has left. Callers without a signal keep it alive.

export function createSingleFlight() {
  const inflight = new Map();

  function remove(key, entry) {
    if (inflight.get(key) === entry) inflight.delete(key);
  }

  function wait(key, entry, signal) {
    if (!signal) {
      entry.pinned = true;
      return entry.promise;
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        entry.waiters -= 1;
        if (entry.waiters === 0 && !entry.pinned) {
          // Nobody is left to receive the result: stop the request and let
          // the next caller start fresh instead of joining an aborting entry.
          remove(key, entry);
          entry.controller.abort(signal.reason);
        }
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (err) => {
          signal.removeEventListener("abort", onAbort);
          reject(err);
        },
      );
    });
  }

  // `run(signal)` performs the shared work; its signal aborts when all
  // cancellable callers are gone.
  return function singleFlight(key, run, signal) {
    signal?.throwIfAborted();
    let entry = inflight.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, waiters: 0, pinned: false, promise: undefined };
      const created = entry;
      created.promise = Promise.resolve()
        .then(() => run(controller.signal))
        .finally(() => remove(key, created));
      // Every caller may have left by the time it settles; never leak an
      // unhandled rejection from the shared promise itself.
      created.promise.catch(() => {});
      inflight.set(key, created);
    }
    if (signal) entry.waiters += 1;
    return wait(key, entry, signal);
  };
}
