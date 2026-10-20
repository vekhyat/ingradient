import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { enGB } from '../copy/en-GB';
import { useReducedMotion } from '../motion/reduced-motion';
import { useColors } from '../theme/ThemeProvider';
import { radius, size, space } from '../theme/tokens';
import { AppText } from './AppText';
import { Button, type ButtonProps } from './Button';
import { Icon } from './Icon';
import { Touchable } from './Touchable';
import { useInitialFocus } from './useInitialFocus';

export interface SheetProps {
  visible: boolean;
  title: string;
  dirty: boolean;
  onClose: () => void;
  children: ReactNode;
  primaryAction?: ButtonProps;
  secondaryAction?: ButtonProps;
}

/**
 * Component 04. A short task on top of the current screen. Close, system
 * Back and a scrim tap do the same thing; when there are unsaved edits they
 * ask "Discard changes?" first. Grows to full height at large text sizes,
 * with Close always visible at the top.
 */
export function Sheet({
  visible,
  title,
  dirty,
  onClose,
  children,
  primaryAction,
  secondaryAction,
}: SheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const titleRef = useInitialFocus(visible);

  const requestClose = () => {
    if (dirty) {
      setConfirmingDiscard(true);
      return;
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType={reducedMotion ? 'none' : 'slide'}
      onRequestClose={requestClose}
      onDismiss={() => setConfirmingDiscard(false)}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={enGB.common.close}
          importantForAccessibility="no"
          accessibilityElementsHidden
          onPress={requestClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel={title}
          style={{
            maxHeight: '100%',
            backgroundColor: colors.bg,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingTop: space.s2,
            paddingBottom: insets.bottom + space.s4,
            elevation: 16,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -8 },
            shadowOpacity: colors.bg === '#FFFFFF' ? 0.12 : 0.5,
            shadowRadius: 24,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 32,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.hair2,
            }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              paddingHorizontal: space.s4,
              paddingTop: space.s2,
              gap: space.s2,
            }}
          >
            <AppText
              ref={titleRef}
              variant="heading"
              heading
              style={{ flex: 1, paddingTop: space.s3 }}
            >
              {confirmingDiscard ? enGB.sheet.discardTitle : title}
            </AppText>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={enGB.common.close}
              radius={radius.full}
              onPress={requestClose}
              style={{
                width: size.targetMin,
                height: size.targetMin,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="close" color={colors.ink} />
            </Touchable>
          </View>

          {confirmingDiscard ? (
            <View style={{ padding: space.s4, gap: space.s4 }}>
              <AppText>{enGB.sheet.discardBody}</AppText>
              <View style={{ gap: space.s3 }}>
                <Button
                  label={enGB.sheet.keepReviewing}
                  variant="tonal"
                  onPress={() => setConfirmingDiscard(false)}
                />
                <Button
                  label={enGB.sheet.discard}
                  variant="outline"
                  onPress={() => {
                    setConfirmingDiscard(false);
                    onClose();
                  }}
                />
              </View>
            </View>
          ) : (
            <>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{
                  padding: space.s4,
                  gap: space.s4,
                }}
              >
                {children}
              </ScrollView>
              {primaryAction || secondaryAction ? (
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: space.s3,
                    paddingHorizontal: space.s4,
                  }}
                >
                  {secondaryAction ? (
                    <View style={{ flexGrow: 1, minWidth: 140 }}>
                      <Button {...secondaryAction} />
                    </View>
                  ) : null}
                  {primaryAction ? (
                    <View style={{ flexGrow: 1, minWidth: 140 }}>
                      <Button {...primaryAction} />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
