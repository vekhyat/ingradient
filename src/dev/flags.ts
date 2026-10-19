/**
 * The developer playground shows in development builds, and in a release
 * build bundled with EXPO_PUBLIC_SHOW_DEV_TOOLS=1 for review on a phone.
 * Store builds leave the variable unset, so fixtures never reach real users.
 */
export const devToolsEnabled =
  __DEV__ || process.env.EXPO_PUBLIC_SHOW_DEV_TOOLS === '1';
