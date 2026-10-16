const expoPreset = require('jest-expo/jest-preset');

// @noble/hashes ships ES modules only, so Jest must transform it like the Expo packages.
const [expoModules, ...otherIgnores] = expoPreset.transformIgnorePatterns;

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  transformIgnorePatterns: [
    expoModules.replace(
      '(?!(',
      '(?!(@noble/hashes|@material/material-color-utilities|',
    ),
    ...otherIgnores,
  ],
};
