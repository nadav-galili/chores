/**
 * The one place a photo proof's R2 key is named (ADR-0017): the presign, the parent's read, the
 * `complete` op's check and the review seed all agree on it because they all call this.
 */
export const photoKey = (childId: string, completionId: string) =>
  `children/${childId}/completions/${completionId}`;
