const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Keep the app running when the system font size or display size changes.
 * Without these, Android recreates MainActivity and the app returns to Scan,
 * losing the open screen and any label in progress (NAT-01 finding 1).
 */
const EXTRA_CHANGES = ['fontScale', 'density'];

module.exports = function withAndroidFontScale(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    const main = application?.activity?.find(
      (activity) => activity.$['android:name'] === '.MainActivity',
    );
    if (!main) {
      throw new Error('with-android-font-scale: MainActivity not found.');
    }
    const current = (main.$['android:configChanges'] ?? '')
      .split('|')
      .filter(Boolean);
    for (const change of EXTRA_CHANGES) {
      if (!current.includes(change)) {
        current.push(change);
      }
    }
    main.$['android:configChanges'] = current.join('|');
    return mod;
  });
};
