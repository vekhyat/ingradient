import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, TextInput, View } from 'react-native';

import { enGB } from '../copy/en-GB';
import { useColors } from '../theme/ThemeProvider';
import { radius, size, space, type } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

export type BarcodeFieldError =
  | 'empty'
  | 'invalid_chars'
  | 'invalid_length'
  | 'invalid_checksum'
  | 'too_long';

export type TranscriptionFieldError =
  'empty' | 'unit_required' | 'basis_required';

export type TextFieldProps =
  | {
      purpose: 'barcode';
      label: string;
      value: string;
      error?: BarcodeFieldError;
      disabled?: boolean;
      /**
       * Open the keyboard when the field appears. Skipped while a screen
       * reader runs, so its focus stays on the sheet title (component 04).
       */
      autoFocus?: boolean;
      onChange: (next: string) => void;
      onSubmit: () => void;
    }
  | {
      purpose: 'transcription';
      label: string;
      value: string;
      originalPrinted: string;
      unit?: string;
      basis?: string;
      error?: TranscriptionFieldError;
      disabled?: boolean;
      onChange: (next: string) => void;
    };

const SIX_LINES = type.body.lineHeight * 6;

/**
 * Component 02. Edits a barcode or one printed transcription. Errors name the
 * fix. A correction changes the transcription only; it never certifies what
 * an ingredient is.
 */
export function TextField(props: TextFieldProps) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);
  const autoFocus = props.purpose === 'barcode' && props.autoFocus === true;

  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    let active = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((screenReader) => {
        if (active && !screenReader) {
          input.current?.focus();
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [autoFocus]);
  const errorText =
    props.error === undefined
      ? null
      : props.purpose === 'barcode'
        ? enGB.field.barcodeErrors[props.error]
        : enGB.field.transcriptionErrors[props.error];
  const helper =
    props.purpose === 'barcode'
      ? enGB.field.barcodeHelper
      : enGB.field.printedAs(props.originalPrinted);
  const unitLine =
    props.purpose === 'transcription' && (props.unit || props.basis)
      ? [props.unit, props.basis].filter(Boolean).join(' · ')
      : null;

  return (
    <View style={{ gap: space.s2 }}>
      <AppText variant="label" color="ink2" nativeID={`${props.purpose}-label`}>
        {props.label}
      </AppText>
      <View
        style={{
          flexDirection: 'row',
          alignItems: props.purpose === 'barcode' ? 'center' : 'flex-start',
          borderRadius: radius.sm,
          borderWidth: focused ? 2 : 1,
          borderColor: errorText
            ? colors.alertInk
            : focused
              ? colors.focus
              : colors.hair2,
          backgroundColor: colors.bg,
          paddingLeft: space.s3,
        }}
      >
        <TextInput
          ref={input}
          accessibilityLabel={props.label}
          accessibilityLabelledBy={`${props.purpose}-label`}
          accessibilityState={{ disabled: props.disabled ?? false }}
          editable={!props.disabled}
          value={props.value}
          onChangeText={props.onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={
            props.purpose === 'barcode'
              ? enGB.field.barcodePlaceholder
              : undefined
          }
          placeholderTextColor={colors.ink3}
          keyboardType={props.purpose === 'barcode' ? 'number-pad' : 'default'}
          returnKeyType={props.purpose === 'barcode' ? 'search' : 'default'}
          onSubmitEditing={
            props.purpose === 'barcode' ? () => props.onSubmit() : undefined
          }
          multiline={props.purpose === 'transcription'}
          autoCorrect={false}
          autoCapitalize="none"
          style={[
            type.body,
            {
              flex: 1,
              color: colors.ink,
              minHeight: size.targetMin,
              maxHeight:
                props.purpose === 'transcription' ? SIX_LINES + 24 : undefined,
              paddingVertical: space.s3,
              textAlignVertical: 'top',
            },
          ]}
        />
        {props.value.length > 0 && !props.disabled ? (
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={enGB.field.clear}
            radius={radius.full}
            onPress={() => props.onChange('')}
            style={{
              width: size.targetMin,
              height: size.targetMin,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="close" color={colors.ink2} />
          </Touchable>
        ) : null}
      </View>
      {unitLine ? (
        <AppText variant="bodySm" color="ink2">
          {unitLine}
        </AppText>
      ) : null}
      {errorText ? (
        <AppText
          variant="bodySm"
          color="alertInk"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {errorText}
        </AppText>
      ) : (
        <AppText variant="bodySm" color="ink3">
          {helper}
        </AppText>
      )}
    </View>
  );
}
