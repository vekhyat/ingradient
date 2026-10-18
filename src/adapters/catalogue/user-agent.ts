/**
 * Builds the identifying User-Agent for Open Food Facts requests.
 *
 * Open Food Facts asks callers to identify the app and version. The string
 * names the app, platform, version and the public project page only. It must
 * never carry an email, a device id or an account id.
 */
export const OFF_PROJECT_URL = 'https://github.com/vekhyat/ingradient';

export function buildOffUserAgent(
  platformOs: string,
  appVersion: string,
): string {
  const platform = platformOs === 'ios' ? 'iOS' : 'Android';
  const trimmed = appVersion.trim();
  const version = trimmed === '' ? '0.0.0' : trimmed;
  return `Ingradient - ${platform} - Version ${version} - ${OFF_PROJECT_URL}`;
}
