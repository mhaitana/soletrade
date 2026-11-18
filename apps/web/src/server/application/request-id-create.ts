import "server-only";

/**
 * Create a record under an id the browser chose for this draft, so saving twice cannot make
 * two records. The form keeps one id per draft and sends it with every attempt. When a
 * create fails and a record with that id already exists in the workspace, the earlier
 * attempt went through and only its response was lost, so the existing id is returned. A
 * normal save costs nothing extra; the lookup runs only after a failure.
 *
 * `existsInWorkspace` must be scoped to the caller's workspace: an id that belongs to
 * another workspace makes the create fail and is reported as that failure.
 */
export async function createWithRequestId<Id extends string>(
  requestId: Id | undefined,
  create: (id: Id | undefined) => Promise<Id>,
  existsInWorkspace: (id: Id) => Promise<boolean>,
): Promise<{ id: Id; replayed: boolean }> {
  try {
    return { id: await create(requestId), replayed: false };
  } catch (error) {
    if (requestId && (await existsInWorkspace(requestId).catch(() => false))) {
      return { id: requestId, replayed: true };
    }
    throw error;
  }
}
