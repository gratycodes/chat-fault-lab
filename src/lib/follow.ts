/**
 * "Stick to bottom" decisions for a streaming transcript, as a pure function.
 *
 * The hard part is telling a user scroll from a scroll caused by content
 * growing or by our own follow. Only scroll events that happen shortly after a
 * user gesture (wheel, touch, key, pointer on the scrollbar) can detach.
 */

export interface FollowInput {
  following: boolean;
  /** Pixels between the bottom of the viewport and the end of the content. */
  distanceFromBottom: number;
  /** scrollTop delta since the previous scroll event. Negative = moved up. */
  deltaY: number;
  /** True if a user gesture happened within the gesture window. */
  userGesture: boolean;
  threshold?: number;
}

export function nextFollowing({ following, distanceFromBottom, deltaY, userGesture, threshold = 48 }: FollowInput): boolean {
  if (!userGesture) return following;
  if (deltaY < 0 && distanceFromBottom > 2) return false;
  if (distanceFromBottom <= threshold) return true;
  return following;
}
