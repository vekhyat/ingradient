/**
 * Design tokens from plan/ui/DESIGN-LANGUAGE.md (UX-04, accepted with K5/D99).
 *
 * Two kinds of colour live here:
 * - Role colours (bg, ink, primary, ...) can come from the phone's wallpaper
 *   palette (Material You, D48). The tables below are the static forest
 *   fallback used when dynamic colour is unavailable or fails contrast.
 * - Fixed colours (grades, alert, camera) never follow the wallpaper, so a
 *   grade C is the same amber on every phone.
 */

export type ColorScheme = 'light' | 'dark';

/** Colours that may follow the wallpaper. */
export interface RoleColors {
  bg: string;
  card: string;
  card2: string;
  ink: string;
  ink2: string;
  ink3: string;
  hair: string;
  hair2: string;
  primary: string;
  onPrimary: string;
  primarySoft: string;
  onPrimarySoft: string;
}

export type RoleName = keyof RoleColors;

/** Colours that never follow the wallpaper. */
export interface FixedColors {
  badgeRing: string;
  alertSurface: string;
  alertInk: string;
  alertBody: string;
  gradeA: string;
  gradeB: string;
  gradeC: string;
  gradeD: string;
  gradeE: string;
  onGrade: string;
  mint: string;
  camera: string;
  onCamera: string;
  scrim: string;
}

export type ThemeColors = RoleColors & FixedColors & { focus: string };

export const STATIC_ROLES: Record<ColorScheme, RoleColors> = {
  light: {
    bg: '#FFFFFF',
    card: '#F4F7F5',
    card2: '#E9EFEB',
    ink: '#0F1A16',
    ink2: '#44504A',
    ink3: '#5F6A65',
    hair: '#E1E6E3',
    hair2: '#87918C',
    primary: '#164E3A',
    onPrimary: '#FFFFFF',
    primarySoft: '#E2F0E8',
    onPrimarySoft: '#164E3A',
  },
  dark: {
    bg: '#0E1311',
    card: '#18201C',
    card2: '#222C27',
    ink: '#EEF3F0',
    ink2: '#BCC6C1',
    ink3: '#97A39D',
    hair: '#2A3530',
    hair2: '#6F7B75',
    primary: '#86D3AE',
    onPrimary: '#08261A',
    primarySoft: '#1F3A2E',
    onPrimarySoft: '#BDE8D2',
  },
};

const GRADES = {
  gradeA: '#0E6B47',
  gradeB: '#4D7C0F',
  gradeC: '#A16207',
  gradeD: '#C2410C',
  gradeE: '#B42318',
  onGrade: '#FFFFFF',
  mint: '#34D399',
  camera: '#0B100E',
  onCamera: '#F2F7F4',
} as const;

export const FIXED: Record<ColorScheme, FixedColors> = {
  light: {
    ...GRADES,
    badgeRing: '#FFFFFF',
    alertSurface: '#FFF0F3',
    alertInk: '#9F1239',
    alertBody: '#5C1A2B',
    scrim: 'rgba(15,26,22,0.45)',
  },
  dark: {
    ...GRADES,
    badgeRing: '#97A39D',
    alertSurface: '#3A1520',
    alertInk: '#FFB3C1',
    alertBody: '#FFD9E0',
    scrim: 'rgba(0,0,0,0.60)',
  },
};

/** Spacing scale in logical units (space-1 … space-6). */
export const space = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 24,
  s6: 32,
} as const;

export const radius = {
  sm: 8,
  md: 16,
  lg: 28,
  /** Large enough to make any control a pill; RN clamps it to half the height. */
  full: 999,
} as const;

export const size = {
  targetMin: 48,
  targetPrimary: 52,
  appBar: 64,
  navBar: 80,
  navIndicatorWidth: 64,
  navIndicatorHeight: 32,
  badgeLg: 72,
  badgeMd: 40,
  badgeSm: 28,
  badgeRing: 2,
  focusStroke: 2,
  focusOffset: 2,
  icon: 24,
} as const;

export const fontFamily = {
  heading: 'PlusJakartaSans_700Bold',
  headingSemi: 'PlusJakartaSans_600SemiBold',
  headingHeavy: 'PlusJakartaSans_800ExtraBold',
  body: 'Inter_400Regular',
  bodyBold: 'Inter_700Bold',
  icon: 'MaterialSymbolsRounded_400Regular',
  iconFilled: 'MaterialSymbolsRounded_400Regular_Filled',
} as const;

export interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

/**
 * Type scale. Sizes are logical units, so they scale with the OS font size
 * setting. Weight is carried by the font file, not fontWeight, because
 * Android does not synthesise weights for custom fonts.
 */
export const type = {
  display: { fontFamily: fontFamily.heading, fontSize: 28, lineHeight: 34 },
  title: { fontFamily: fontFamily.heading, fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: fontFamily.heading, fontSize: 18, lineHeight: 24 },
  subhead: { fontFamily: fontFamily.headingSemi, fontSize: 16, lineHeight: 22 },
  gradeLetter: {
    fontFamily: fontFamily.headingHeavy,
    fontSize: 32,
    lineHeight: 36,
  },
  body: { fontFamily: fontFamily.body, fontSize: 16, lineHeight: 24 },
  bodySm: { fontFamily: fontFamily.body, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fontFamily.bodyBold, fontSize: 12, lineHeight: 16 },
  button: { fontFamily: fontFamily.bodyBold, fontSize: 16, lineHeight: 20 },
  data: { fontFamily: fontFamily.bodyBold, fontSize: 14, lineHeight: 20 },
} as const satisfies Record<string, TypeStyle>;

export type TypeName = keyof typeof type;
