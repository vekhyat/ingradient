/**
 * Design tokens for the nutrition-panel direction (owner, 2026-10-19): the
 * S1 prototype in plan/ui/screens/index.html. Paper white and ink black,
 * one heavy rule, figures in a mono face, and one signature colour,
 * turmeric, meaning "being read right now".
 *
 * Two kinds of colour live here:
 * - Role colours (bg, ink, primary, ...). The resolver can still accept a
 *   wallpaper palette, but the app passes none: this direction is fixed.
 * - Fixed colours (grades, turmeric, alert, camera).
 */

export type ColorScheme = 'light' | 'dark';

/** Surface and text roles. */
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

/** Colours that never change with the role palette. */
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
  /** Turmeric: the highlighter stroke and the selected-tab mark. */
  accent: string;
  onAccent: string;
  mint: string;
  camera: string;
  onCamera: string;
  scrim: string;
}

export type ThemeColors = RoleColors & FixedColors & { focus: string };

export const STATIC_ROLES: Record<ColorScheme, RoleColors> = {
  light: {
    bg: '#FFFFFF',
    card: '#EFEFEF',
    card2: '#E4E4E4',
    ink: '#121212',
    ink2: '#474747',
    ink3: '#636363',
    hair: '#DEDEDE',
    hair2: '#808080',
    primary: '#121212',
    onPrimary: '#FFFFFF',
    primarySoft: '#EFEFEF',
    onPrimarySoft: '#121212',
  },
  dark: {
    bg: '#121212',
    card: '#1E1E1E',
    card2: '#2A2A2A',
    ink: '#F5F5F5',
    ink2: '#C4C4C4',
    ink3: '#A3A3A3',
    hair: '#363636',
    hair2: '#777777',
    primary: '#F5F5F5',
    onPrimary: '#121212',
    primarySoft: '#1E1E1E',
    onPrimarySoft: '#F5F5F5',
  },
};

const GRADES = {
  gradeA: '#17744B',
  gradeB: '#4A7413',
  gradeC: '#965F00',
  gradeD: '#B0431B',
  gradeE: '#A0263E',
  onGrade: '#FFFFFF',
  accent: '#F2B705',
  onAccent: '#121212',
  mint: '#34D399',
  camera: '#0E0E0D',
  onCamera: '#F4F4F1',
} as const;

export const FIXED: Record<ColorScheme, FixedColors> = {
  light: {
    ...GRADES,
    badgeRing: '#121212',
    alertSurface: '#FFF0F3',
    alertInk: '#9F1239',
    alertBody: '#5C1A2B',
    scrim: 'rgba(18,18,18,0.36)',
  },
  dark: {
    ...GRADES,
    badgeRing: '#F5F5F5',
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
  /** Buttons, stamps and fields: nearly square, like print. */
  sm: 4,
  md: 6,
  /** Sheet tops. */
  lg: 14,
  /** Large enough to make any control a pill; RN clamps it to half the height. */
  full: 999,
} as const;

export const size = {
  targetMin: 48,
  targetPrimary: 52,
  appBar: 48,
  navBar: 64,
  navIndicatorWidth: 64,
  navIndicatorHeight: 32,
  /** Grade stamps: Result headline, large, list rows, compact. */
  badgeXl: 64,
  badgeLg: 56,
  badgeMd: 40,
  badgeSm: 28,
  /** The heavy black rule that closes the Result grade section. */
  rule: 8,
  badgeRing: 2,
  focusStroke: 2,
  focusOffset: 2,
  icon: 24,
} as const;

export const fontFamily = {
  heading: 'WorkSans_700Bold',
  headingSemi: 'WorkSans_500Medium',
  headingHeavy: 'WorkSans_900Black',
  body: 'WorkSans_400Regular',
  bodyBold: 'WorkSans_700Bold',
  mono: 'IBMPlexMono_500Medium',
  icon: 'MaterialSymbolsRounded_400Regular',
  iconFilled: 'MaterialSymbolsRounded_400Regular_Filled',
} as const;

export interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: 'uppercase';
}

/**
 * Type scale from the S1 prototype. Sizes are logical units, so they scale
 * with the OS font size setting. Weight is carried by the font file, not
 * fontWeight, because Android does not synthesise weights for custom fonts.
 */
export const type = {
  /** Product name on Result; screen titles on the tab roots. */
  display: {
    fontFamily: fontFamily.heading,
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.6,
  },
  /** A statement: "Milk solids are in this one." */
  title: {
    fontFamily: fontFamily.heading,
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  heading: {
    fontFamily: fontFamily.headingHeavy,
    fontSize: 20,
    lineHeight: 24,
  },
  /** A row's lead line: "Sugar", "Whole wheat flour". */
  subhead: { fontFamily: fontFamily.heading, fontSize: 17, lineHeight: 23 },
  gradeLetter: {
    fontFamily: fontFamily.headingHeavy,
    fontSize: 34,
    lineHeight: 38,
  },
  body: { fontFamily: fontFamily.body, fontSize: 16, lineHeight: 24 },
  bodySm: { fontFamily: fontFamily.body, fontSize: 14, lineHeight: 20 },
  /** Small capitals over a section: "FOR YOU", "INGREDIENTS · 9". */
  label: {
    fontFamily: fontFamily.bodyBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  button: { fontFamily: fontFamily.bodyBold, fontSize: 16, lineHeight: 20 },
  /** Figures: tabular mono, "27 g". */
  data: {
    fontFamily: fontFamily.mono,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: 0.3,
  },
  /** Codes and meta: "INS 129", "BRIGHTFIELD FOODS · 375 g". */
  code: {
    fontFamily: fontFamily.mono,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 0.26,
  },
} as const satisfies Record<string, TypeStyle>;

export type TypeName = keyof typeof type;
