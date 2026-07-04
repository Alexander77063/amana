/**
 * Registry of detached "fire-and-forget" tasks — best-effort work (notification dispatches) that
 * must not block the request/transaction that scheduled it.
 *
 * **Production never drains.** Tasks self-remove when they settle, so the set only ever holds
 * currently in-flight work (bounded by concurrency, no leak) and `runInBackground` stays truly
 * fire-and-forget.
 *
 * **Tests drain.** `truncateAll()` awaits `drainBackgroundTasks()` before deleting rows, so a
 * detached notification insert can't race the DELETE of the `users` row it references (the
 * `notifications_recipient_user_id_users_id_fk` violations that flooded the suite) or contend with
 * truncation for the shared app-pool connections and row locks (which slowed unrelated tests until
 * one tipped past the 30s timeout).
 */
const pending = new Set<Promise<unknown>>();

/** Schedule a detached best-effort task. The promise MUST have its own error handling (`.catch`). */
export function runInBackground(task: Promise<unknown>): void {
  pending.add(task);
  void task.finally(() => {
    pending.delete(task);
  });
}

/** Await all currently in-flight background tasks. Loops so tasks that schedule more still settle. */
export async function drainBackgroundTasks(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

/** Number of in-flight background tasks — for assertions/diagnostics. */
export function pendingBackgroundTaskCount(): number {
  return pending.size;
}
