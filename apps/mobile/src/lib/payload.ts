/**
 * The one shape check between the parent's REST calls and the screens that index their results.
 *
 * `call<T>()` casts the JSON and believes it. That is fine until the server is older than the
 * app — a field the app has and the deployment has not comes back `undefined`, the screen reads
 * `.length` off it, and React Native takes the whole process down: the parent is returned to
 * their home screen with no message anywhere. That is what a signed-in parent met after Google
 * sign-in while the API still predated M2's `redemptions`.
 *
 * So the lists a screen will walk are checked where they arrive. A miss throws, `useParentToday`
 * catches it like any other failed read, and the screen shows its error state with the cause and
 * a retry — which is a deployment being behind, said out loud, instead of a crash.
 */
export function requireArrays<T>(value: T, fields: readonly (keyof T & string)[], what: string): T {
  const missing = fields.filter((field) => !Array.isArray(value?.[field]));
  if (missing.length) {
    throw new Error(`${what} is missing ${missing.join(', ')} — the server may be out of date`);
  }
  return value;
}
