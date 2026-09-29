/**
 * The App Review account (#100). The address is not a secret — the secret lives only on the
 * server. One constant for both sides: the sign-in screen asks for the secret when this address is
 * typed, and the API refuses to start when its `REVIEW_EMAIL` names any other address.
 */
export const REVIEW_EMAIL = 'review@mibokids.app';
