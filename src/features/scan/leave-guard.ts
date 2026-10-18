import type { RootTab } from '../../components/NavBar';

/**
 * Component 06: leaving Scan while a label is in progress is the journey's
 * discard question, never a silent reset. Every other tab change just goes.
 */
export function leaveScanDecision(
  from: RootTab,
  to: RootTab,
  labelDirty: boolean,
): 'go' | 'ask' {
  return from === 'scan' && to !== 'scan' && labelDirty ? 'ask' : 'go';
}
