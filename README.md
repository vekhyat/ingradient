# Ingradient

Ingradient is an Expo development app for Android and iOS that reads packaged-food barcodes and English labels. It combines Open Food Facts lookups, on-device OCR, reviewable ingredient and nutrition facts, and scientific assessments with source citations. Missing or unsupported evidence produces an explicit gap rather than an invented grade.

## Architecture and data flow

- Barcode scans and typed barcodes query Open Food Facts directly. Validated catalogue responses become product snapshots with source references and observations.
- Label photos are read on the phone with ML Kit. Capture and review keep ingredients and nutrition panels separate, let the user correct text, and record provenance for facts used in analysis. Photos are temporary session files and are never uploaded.
- The phone pipeline parses ingredients and nutrition, matches exact taxonomy identities, calculates supported Nutri-Score routes, and renders reasons from pinned resources. Contracts and scientific resources live in `contracts/` and `resources/`; their manifests pin the original bytes.
- With `EXPO_PUBLIC_ANALYSIS_URL` unset, analysis stays on the phone. When configured, the hybrid client sends contract product facts to `POST /v1/analyses` after the versioned onboarding notice is accepted. Photos, saved history and personal settings are excluded. A slow or unavailable server triggers phone analysis; a late answer must pass compatibility and replay checks before it can be offered as an update. Displayed reasons use the phone's templates.
- Saved results and their source facts live in a local SQLCipher database. Its encryption key and notice acceptance use SecureStore. History supports local deletion and erase controls; session photos are separate from saved-result records.

FastAPI exposes health and analysis endpoints. Its default `app.main:app` serves a named method gap with collection off; the development entrypoint `deploy.app:app` explicitly enables reference analysis and keeps collection off. The checked-in Render blueprint selects that development entrypoint. The optional PostgreSQL learning store is isolated from the default app and has no production database wiring. See [backend/README.md](backend/README.md) for the exact boundary and test setup.

## Install and check

Use Node.js 24 and Bun 1.4.3, matching CI. Bun installs dependencies; Node runs Expo and Jest tooling. From this directory:

```powershell
bun install --frozen-lockfile
bun run check
```

The root install hook applies the camera focus patch used by the native config plugin. Keep `bun.lock` as the dependency lockfile; avoid creating a competing npm lockfile.

`check` runs TypeScript, ESLint, Prettier and Jest. CI runs these checks on Ubuntu and Windows for every change, including tools, modules, native plugins and root configuration. It also exports Android and iOS JavaScript on Ubuntu. Additional checks:

```powershell
bunx --no-install expo install --check
bunx --no-install expo export --platform android --platform ios
bun audit
```

JavaScript export does not compile a native app or verify camera, OCR or SQLCipher on a device. Dependency advisories need their own review; passing app checks does not clear them. Run the backend and Python/TypeScript parity checks documented in the [backend README](backend/README.md) when changing shared scientific behavior.

Source and configuration files use LF, enforced by `.gitattributes`, EditorConfig and Prettier. Pinned `contracts/` and `resources/` bytes are exempt from line-ending conversion and formatting. Do not repin them to resolve a formatting failure.

## Android on Windows

Install Android Studio with its SDK and bundled Java runtime. Enable USB debugging, connect the phone and accept its debugging prompt. Set the paths for your installation:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
adb devices -l
bun run android
```

This builds and installs a development client with native camera, ML Kit and SQLCipher dependencies. Use a development build rather than Expo Go. Accept the draft onboarding notice, then check barcode lookup, label capture, OCR review, results and local history on the device.

For later sessions, `bun run start` starts Metro for Wi-Fi. USB development uses:

```powershell
adb reverse tcp:8081 tcp:8081
bun run start:usb
```

To use a local backend on that phone, also reverse port 8000 and set the public analysis URL before starting Metro:

```powershell
adb reverse tcp:8000 tcp:8000
$env:EXPO_PUBLIC_ANALYSIS_URL = 'http://127.0.0.1:8000'
bun run start:usb
```

For an Android emulator use `http://10.0.2.2:8000` instead. The backend's default entrypoint returns a named method gap; configuring its URL alone does not activate the reference scoring service. Clear the variable to restore phone-only analysis. Public Expo variables are bundled configuration, so never put credentials in them.

Native dependency or app-configuration changes require rebuilding the client. For an ARM64 debug APK without a connected phone:

```powershell
bun run prebuild --platform android
$env:NODE_ENV = 'development'
Push-Location android
try {
  .\gradlew.bat 'assembleDebug' '--console=plain' '-PreactNativeArchitectures=arm64-v8a' '--max-workers=2'
} finally { Pop-Location }
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Generated `android/`, `ios/`, `.expo/` and `dist/` stay out of Git. Change native behavior through `app.json`, `plugins/` or `modules/`.

## iOS and deployment

iOS native builds need macOS/Xcode or a separately configured EAS build. `eas.json` defines an internal development profile. The current `com.example.ingradient.dev` identifiers and development scheme are placeholders; the repository does not provision signing credentials or publish the app. Backend process and release requirements are in the [backend README](backend/README.md).

## Source map

- `src/app/`: Expo Router routes for scanning, review, results, history, onboarding and disclosures.
- `src/features/` and `src/components/`: application flows and UI.
- `src/adapters/`: catalogue and hybrid network boundaries, native OCR and encrypted storage.
- `src/domain/`: contracts, parsing, matching, scientific calculation and evidence rendering.
- `modules/dynamic-colour/` and `plugins/`: native theme integration and build configuration.
- `backend/`: FastAPI boundary, Python scientific implementation and isolated learning-store tooling.
- `tools/resources/` and `tools/parity/`: resource integrity, generation and cross-runtime comparisons.
- `.github/workflows/`: app, backend, parity and disposable PostgreSQL checks.
