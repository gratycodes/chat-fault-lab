import { nextFollowing } from './follow';

describe('nextFollowing', () => {
  it('ignores scrolls that were not caused by the user', () => {
    expect(nextFollowing({ following: true, distanceFromBottom: 400, deltaY: -50, userGesture: false })).toBe(true);
    expect(nextFollowing({ following: false, distanceFromBottom: 0, deltaY: 50, userGesture: false })).toBe(false);
  });
  it('detaches on any upward user scroll, even a small one', () => {
    expect(nextFollowing({ following: true, distanceFromBottom: 10, deltaY: -10, userGesture: true })).toBe(false);
  });
  it('re-attaches when the user scrolls back near the bottom', () => {
    expect(nextFollowing({ following: false, distanceFromBottom: 30, deltaY: 200, userGesture: true })).toBe(true);
    expect(nextFollowing({ following: false, distanceFromBottom: 300, deltaY: 200, userGesture: true })).toBe(false);
  });
});
