import manifestJson from '../../../resources/manifest.json';
import methodJson from '../../../resources/method/nutriscore-updated-2023.json';
import {
  DEFAULT_EVIDENCE_VERSION,
  DEFAULT_TAXONOMY_VERSION,
} from '../../adapters/catalogue/types';

/** The public resources installed on the phone, as the request names them. */
export interface ResourceCompatibility {
  readonly taxonomyVersion: string;
  readonly evidenceVersion: string;
  readonly methodEdition: string;
  readonly methodBundleSha256: string;
}

const METHOD_BUNDLE_ID = 'nutriscore-updated-2023';

/**
 * Reads the installed editions from the pinned resource files. The bundle
 * hash is the manifest's; the drift test checks it against the file bytes.
 */
export function installedResources(): ResourceCompatibility {
  const bundle = manifestJson.bundles.find(
    (item) => item.bundleId === METHOD_BUNDLE_ID,
  );
  if (!bundle) {
    throw new Error(`Resource manifest has no ${METHOD_BUNDLE_ID} bundle.`);
  }
  return {
    taxonomyVersion: DEFAULT_TAXONOMY_VERSION,
    evidenceVersion: DEFAULT_EVIDENCE_VERSION,
    methodEdition: methodJson.edition,
    methodBundleSha256: bundle.sha256,
  };
}
