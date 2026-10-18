const { patchFocus } = require('../tools/camera/patch-focus.cjs');
const { withPodfile } = require('expo/config-plugins');

module.exports = function withCameraFocus(config) {
  patchFocus();
  return withPodfile(config, (mod) => {
    const directive =
      "$ExpoUseSources = ($ExpoUseSources || []) | ['expo-camera']";
    if (!mod.modResults.contents.includes(directive)) {
      mod.modResults.contents = directive + '\n' + mod.modResults.contents;
    }
    return mod;
  });
};
