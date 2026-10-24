/** The actual parent viewport/selection tasks share one late-publication guard.
 * Failure is as source-sensitive as success; no stale rejection owns newer UI. */
export async function publishParentUiTask<T>(task: Promise<T>, current: () => boolean,
  success: (value: T) => void, failure: (error: unknown) => void): Promise<void> {
  try { const value = await task; if (current()) success(value); }
  catch (error) { if (current()) failure(error); }
}
