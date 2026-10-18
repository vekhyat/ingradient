import { PixelRatio, View } from 'react-native';

import { enGB } from '../copy/en-GB';
import { useColors } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import type { LocalProductView } from '../view-models/types';
import { AppText } from './AppText';
import { Card } from './Card';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

export interface ProductIdentityProps {
  product: LocalProductView;
  density: 'hero' | 'row' | 'summary';
  onInspectSource?: () => void;
}

function sourceLine(product: LocalProductView): string {
  switch (product.dataCredit) {
    case 'off':
      return enGB.identity.fromOff;
    case 'label_photo':
      return enGB.identity.fromLabel;
    case 'mixed':
      return enGB.identity.fromMixed;
  }
}

/**
 * Component 09. Which pack this is and where the words came from, before any
 * grade. Open Food Facts results always show the ODbL credit on screen.
 */
export function ProductIdentity({
  product,
  density,
  onInspectSource,
}: ProductIdentityProps) {
  const colors = useColors();
  const name =
    product.name ??
    (product.dataCredit === 'label_photo'
      ? enGB.identity.labelOnlyName
      : enGB.identity.nameMissing);
  const meta = [product.sizeText, sourceLine(product)]
    .filter(Boolean)
    .join(' · ');
  const showOffCredit = product.dataCredit !== 'label_photo';
  const largeText = PixelRatio.getFontScale() >= 1.5;

  if (density === 'summary') {
    // One quiet line: size and source. The ODbL credit names the source
    // for barcode records, so it stands in for the source line there.
    const line = [
      product.sizeText,
      product.dataCredit === 'off' ? null : sourceLine(product),
      showOffCredit ? enGB.identity.offCredit : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <View style={{ gap: space.s1 }}>
        <AppText variant="heading" heading>
          {name}
        </AppText>
        <AppText variant="bodySm" color="ink2">
          {line}
        </AppText>
      </View>
    );
  }

  if (density === 'row') {
    return (
      <View
        accessible
        accessibilityLabel={`${name}. ${sourceLine(product)}`}
        style={{ gap: space.s1, flexShrink: 1 }}
      >
        <AppText variant="subhead">{name}</AppText>
        <AppText variant="bodySm" color="ink2">
          {sourceLine(product)}
        </AppText>
      </View>
    );
  }

  const tile = (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: largeText ? '100%' : 72,
        height: 72,
        borderRadius: radius.sm,
        backgroundColor: colors.card2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="nutrition" color={colors.ink2} />
    </View>
  );

  return (
    <Card style={{ gap: space.s3 }}>
      <View
        accessible
        accessibilityLabel={`${name}. ${meta}`}
        style={{
          flexDirection: largeText ? 'column' : 'row',
          gap: space.s3,
        }}
      >
        {tile}
        <View style={{ flex: largeText ? undefined : 1, gap: space.s1 }}>
          {product.categoryLabel || product.brand ? (
            <AppText variant="label" color="ink2">
              {[product.brand, product.categoryLabel]
                .filter(Boolean)
                .join(' · ')
                .toUpperCase()}
            </AppText>
          ) : null}
          <AppText variant="title" heading>
            {name}
          </AppText>
          <AppText variant="bodySm" color="ink2">
            {meta}
          </AppText>
          {product.name === null && product.barcode ? (
            <AppText variant="bodySm" color="ink2">
              {enGB.identity.barcode(product.barcode)}
            </AppText>
          ) : null}
        </View>
      </View>
      {showOffCredit ? (
        <AppText variant="bodySm" color="ink3">
          {enGB.identity.offCredit}
          {product.image.source === 'off'
            ? ` ${enGB.identity.offPhotoCredit(product.image.creator)}`
            : ''}
        </AppText>
      ) : null}
      {onInspectSource ? (
        <Touchable
          accessibilityRole="button"
          radius={radius.sm}
          onPress={onInspectSource}
          style={{ justifyContent: 'center', alignSelf: 'flex-start' }}
        >
          <AppText variant="data" color="primary">
            {enGB.identity.inspectSource}
          </AppText>
        </Touchable>
      ) : null}
    </Card>
  );
}
