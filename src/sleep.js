/**
 * Resolve after `ms` milliseconds, or at once if `signal` is aborted. It never rejects, so a
 * cancelled run simply stops waiting.
 */
export function sleep(ms, signal) {
  const { promise, resolve } = Promise.withResolvers();
  if (signal?.aborted) {
    resolve();
    return promise;
  }
  const finish = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", finish);
    resolve();
  };
  const timer = setTimeout(finish, ms);
  signal?.addEventListener("abort", finish, { once: true });
  return promise;
}
