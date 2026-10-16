import { Easing } from 'react-native-reanimated';

/**
 * Motion tokens from plan/ui/INTERACTIONS.md §1 (D58). All are proposed
 * product defaults, not measured device performance. Content never waits
 * for any of these: they only decorate state that is already on screen.
 */
export const duration = {
  state: 100,
  expand: 200,
  route: 300,
  sheetIn: 400,
  sheetOut: 200,
  gradeFirst: 600,
  gradeRepeat: 300,
  cameraLock: 200,
} as const;

/** cubic-bezier values from INTERACTIONS.md. */
export const easing = {
  standard: Easing.bezier(0.2, 0, 0, 1),
  emphasizedDecelerate: Easing.bezier(0.05, 0.7, 0.1, 1),
  emphasizedAccelerate: Easing.bezier(0.3, 0, 0.8, 0.15),
  /** Result reveal from the v18 prototype. */
  reveal: Easing.bezier(0.16, 1, 0.3, 1),
} as const;
