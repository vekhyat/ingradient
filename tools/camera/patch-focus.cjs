const fs = require('node:fs');
const path = require('node:path');

// Expo 57 has continuous AF but no point-focus API. Keep this bounded patch
// version checked and repeatable until the installed SDK provides one.
const MARKER = '// Ingradient point focus';
function insert(source, anchor, addition) {
  if (source.includes(MARKER)) return source;
  if (source.split(anchor).length !== 2) {
    throw new Error(
      'Camera focus patch no longer matches Expo. Review before building.',
    );
  }
  return source.replace(anchor, addition + '\n' + anchor);
}

const patches = {
  'android/src/main/java/expo/modules/camera/CameraViewModule.kt': (s) =>
    insert(
      s,
      '      Prop("autoFocus")',
      `      ${MARKER}
      Prop("focusPoint") { view, point: Map<String, Double>? ->
        val x = point?.get("x")
        val y = point?.get("y")
        if (x != null && y != null && x.isFinite() && y.isFinite()) {
          view.focusAtPoint(x.toFloat(), y.toFloat())
        }
      }
`,
    ),
  'android/src/main/java/expo/modules/camera/ExpoCameraView.kt': (s) =>
    insert(
      s,
      '  private fun startFocusMetering() {',
      `  ${MARKER}
  fun focusAtPoint(x: Float, y: Float) {
    val currentCamera = camera ?: return
    if (previewView.width <= 0 || previewView.height <= 0) return
    val point = previewView.meteringPointFactory.createPoint(
      x.coerceIn(0f, 1f) * previewView.width,
      y.coerceIn(0f, 1f) * previewView.height
    )
    val action = FocusMeteringAction.Builder(
      point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE
    ).setAutoCancelDuration(3, java.util.concurrent.TimeUnit.SECONDS).build()
    if (currentCamera.cameraInfo.isFocusMeteringSupported(action)) {
      currentCamera.cameraControl.startFocusAndMetering(action)
    }
  }
`,
    ),
  'ios/CameraViewModule.swift': (s) =>
    insert(
      s,
      '      Prop("autoFocus")',
      `      ${MARKER}
      Prop("focusPoint") { (view, point: [String: Double]?) in
        if let x = point?["x"], let y = point?["y"], x.isFinite, y.isFinite {
          view.focusAtPoint(x: x, y: y)
        }
      }
`,
    ),
  'ios/Current/CameraView.swift': (s) =>
    insert(
      s,
      '  var autoFocus =',
      `  ${MARKER}
  func focusAtPoint(x: Double, y: Double) {
    let layerPoint = CGPoint(
      x: CGFloat(min(1, max(0, x))) * bounds.width,
      y: CGFloat(min(1, max(0, y))) * bounds.height
    )
    let point = previewLayer.captureDevicePointConverted(fromLayerPoint: layerPoint)
    sessionQueue.async { self.sessionManager.focusAtPoint(point) }
  }
`,
    ),
  'ios/Current/CameraSessionManager.swift': (s) =>
    insert(
      s,
      '  func setFocusMode() {',
      `  ${MARKER}
  func focusAtPoint(_ point: CGPoint) {
    guard let device = captureDeviceInput?.device else { return }
    do {
      try device.lockForConfiguration()
      defer { device.unlockForConfiguration() }
      if device.isFocusPointOfInterestSupported {
        device.focusPointOfInterest = point
        if device.isFocusModeSupported(.continuousAutoFocus) {
          device.focusMode = .continuousAutoFocus
        }
      }
      if device.isExposurePointOfInterestSupported {
        device.exposurePointOfInterest = point
        if device.isExposureModeSupported(.continuousAutoExposure) {
          device.exposureMode = .continuousAutoExposure
        }
      }
    } catch {
      log.info("Unable to configure camera focus")
    }
  }
`,
    ),
};

function patchFocus() {
  const root = path.dirname(require.resolve('expo-camera/package.json'));
  const version = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  ).version;
  if (version !== '57.0.6')
    throw new Error(`Review focus patch for expo-camera ${version}`);
  // Validate every source before writing any of them.
  const outputs = Object.entries(patches).map(([file, patch]) => {
    const target = path.join(root, file);
    const original = fs.readFileSync(target, 'utf8');
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    return [
      target,
      patch(original.replace(/\r\n/g, '\n')).replace(/\n/g, newline),
    ];
  });
  for (const [target, output] of outputs) fs.writeFileSync(target, output);
}

module.exports = { patchFocus, patches };
if (require.main === module) patchFocus();
