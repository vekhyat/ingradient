import { View } from 'react-native';

import { space } from '../theme/tokens';
import { AppText } from './AppText';

export interface ResultHeadProps {
  title: string;
  /** Size and source, including the ODbL credit for barcode records. */
  meta: string;
}

/**
 * The top of Result, set like the head of a nutrition panel: the product
 * name large and the meta line in mono. The grade section below carries the
 * stamp and the heavy rule (ADR 015).
 */
export function ResultHead({ title, meta }: ResultHeadProps) {
  return (
    <View style={{ gap: space.s2 }}>
      <AppText variant="display" heading>
        {title}
      </AppText>
      {meta ? (
        <AppText variant="code" color="ink3">
          {meta.toUpperCase()}
        </AppText>
      ) : null}
    </View>
  );
}
