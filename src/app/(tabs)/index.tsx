import { CaptureScreen } from '../../features/scan/CaptureScreen';

/** U01 Scan: barcode or label from the large camera. */
export default function ScanTab() {
  return <CaptureScreen labelOnly={false} />;
}
