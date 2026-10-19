# Ingradient mobile foundation

An Expo development-build scaffold for Android and iOS, written in strict TypeScript. These are temporary development screens. Product UI, scanning, food analysis and backend integration belong to later tasks.

## Install

Use Node.js 24 LTS and Bun 1.4 or later. Bun installs packages; Node still runs Expo, Jest and the Android bundler. From the repository root (the directory containing `package.json`):

```powershell
bun install --frozen-lockfile
bun run check
```

`bun.lock` records the dependency tree so teammates can install the same versions. Do not use `npm install`: it would create a second lockfile that drifts from `bun.lock`. Bun skips dependency install scripts unless a package is listed in `trustedDependencies`; the only one today, `unrs-resolver`, does not need its script.

The Expo app lives directly in this directory: `package.json` and configuration at the root, routes/screens in `src/`, and icons in `assets/`.

## Android on Windows, connected by USB

1. Install Android Studio with its Android SDK and bundled Java runtime. Enable USB debugging on the phone, connect it and accept the computer's debugging prompt.
2. Point this PowerShell session at the tools (adjust these paths if installed elsewhere):

   ```powershell
   $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
   $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
   $env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
   adb devices -l
   ```

3. Build, install and open the development app:

   ```powershell
   bun run android
   ```

4. Check that **App foundation** opens. Tap **Check navigation**, then use Android Back. It should return to the foundation screen.

On later sessions, start Metro with `bun run start` for Wi-Fi, or use USB:

```powershell
adb reverse tcp:8081 tcp:8081
bun run start:usb
```

Reopen the app from the development launcher. `start:usb` uses IPv4-first localhost resolution because this Windows setup otherwise bound Metro to IPv6 while advertising an IPv4 bundle URL. Metro sends updated JavaScript to the installed development app; native dependency or app-configuration changes require rebuilding. Do not change Windows firewall settings just to test USB access.

## Build without a connected phone

After setting the session variables above:

```powershell
bun run prebuild --platform android
$env:NODE_ENV = 'development'
Push-Location android
try {
  .\gradlew.bat 'assembleDebug' '--console=plain' '-PreactNativeArchitectures=arm64-v8a' '--max-workers=2'
} finally { Pop-Location }
```

The ARM64 development APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Use `bun run android` with a connected device to let Expo select its architecture. A successful build is separate from verification on a phone.

## iOS

Windows cannot build iOS locally. `eas.json` contains an internal development-build profile for a future EAS build. No EAS project, credentials, device registration or cloud build is created by this scaffold. The final application identifiers must be accepted before registration or publication.

## Source map

| Path                                                    | Responsibility                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/app/`                                              | File-based routes and their common stack layout                      |
| `src/screens/`                                          | Two temporary screens and their shared scrolling wrapper             |
| `src/copy/en-GB.ts`                                     | English text, separate from rendering; additional locales come later |
| `app.json`, `eas.json`                                  | Native app configuration and the development cloud-build profile     |
| `tsconfig.json`, `eslint.config.js`, `.prettierrc.json` | Type safety, code checks and formatting                              |

There is no API client, database, profile, analytics or data-upload code. The scaffold does not request camera permissions. Expo's development tools have their own development network traffic.

`com.example.ingradient.dev` and `ingradient-dev` are replaceable development identifiers. The launcher icon is the template placeholder. Screens use temporary styles; these are not the product theme. Native headers own the top safe area, and the screen wrapper protects the remaining edges. Text wraps, scales with the device setting and scrolls. Navigation animations are disabled until the motion work is specified.

## Checks

```powershell
bun run check
bunx expo install --check
bunx expo-doctor
bunx expo export --platform android --platform ios
```

`check` runs TypeScript, ESLint and Prettier in sequence. Export checks JavaScript bundling for both native platforms; it does not compile or run an iOS app. There is no scoring, parsing or matching logic yet, so this task does not introduce a logic-test suite. Device checks cover forward navigation, Android Back, large text and screen-reader labels.

Dependency review remains open: on 15 October 2026, `npm audit` reported 28 dependency-tree findings (18 high, 10 moderate). Its proposed fixes include incompatible Expo/React Native changes. No force fix or untested override has been applied; passing Expo Doctor does not clear these audit findings.

Generated `android/`, `ios/`, `.expo/` and `dist/` directories stay out of Git. Change native configuration in `app.json` or an Expo config plugin rather than editing generated native files. Environment files and signing material stay ignored too.

## Official references

1. [Development builds](https://docs.expo.dev/develop/development-builds/introduction/)
2. [Expo Router installation](https://docs.expo.dev/router/installation/)
3. [TypeScript configuration](https://docs.expo.dev/guides/typescript/)
4. [ESLint and Prettier](https://docs.expo.dev/guides/using-eslint/)
5. [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)
