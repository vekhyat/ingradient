import { NON_TEXT_MIN, TEXT_MIN, contrastRatio, isHexColor } from './contrast';
import {
  FIXED,
  STATIC_ROLES,
  type ColorScheme,
  type RoleColors,
  type RoleName,
  type ThemeColors,
} from './tokens';

/**
 * Colour pipeline (DESIGN-LANGUAGE §2, U-THEME-A):
 *
 *   system roles (if the phone gives them) or forest fallback
 *     → contrast guard on every allowed pair
 *     → app tokens + fixed grade/alert/camera colours
 *
 * The guard is all-or-nothing: if one dynamic pair fails, the whole static
 * scheme is used. A half-dynamic, half-static palette is never produced.
 */

export interface ContrastPair {
  fg: RoleName;
  bg: RoleName;
  min: number;
  why: string;
}

/** Every role pair the components are allowed to draw. */
export const ALLOWED_ROLE_PAIRS: readonly ContrastPair[] = [
  ...(['ink', 'ink2', 'ink3'] as const).flatMap((fg) =>
    (['bg', 'card', 'card2'] as const).map((bg) => ({
      fg,
      bg,
      min: TEXT_MIN,
      why: 'reading text on a surface',
    })),
  ),
  { fg: 'primary', bg: 'bg', min: TEXT_MIN, why: 'link and text button' },
  { fg: 'primary', bg: 'card', min: TEXT_MIN, why: 'link inside a card' },
  { fg: 'onPrimary', bg: 'primary', min: TEXT_MIN, why: 'primary button' },
  {
    fg: 'onPrimarySoft',
    bg: 'primarySoft',
    min: TEXT_MIN,
    why: 'tonal button and selected tab',
  },
  { fg: 'hair2', bg: 'bg', min: NON_TEXT_MIN, why: 'control outline' },
  { fg: 'hair2', bg: 'card', min: NON_TEXT_MIN, why: 'control outline' },
  { fg: 'primary', bg: 'card2', min: NON_TEXT_MIN, why: 'focus ring' },
];

export interface PairFailure {
  pair: ContrastPair;
  ratio: number;
}

export function checkRolePairs(roles: RoleColors): PairFailure[] {
  const failures: PairFailure[] = [];
  for (const pair of ALLOWED_ROLE_PAIRS) {
    const ratio = contrastRatio(roles[pair.fg], roles[pair.bg]);
    if (ratio < pair.min) {
      failures.push({ pair, ratio });
    }
  }
  return failures;
}

export type ThemeSource = 'dynamic' | 'static';

export interface ResolvedTheme {
  scheme: ColorScheme;
  source: ThemeSource;
  colors: ThemeColors;
  /** Why the dynamic palette was rejected, for the developer surface only. */
  fallbackReason: string | null;
}

const ROLE_NAMES = Object.keys(STATIC_ROLES.light) as RoleName[];

/** Accepts only a complete set of opaque #RRGGBB roles. */
export function isCompleteRoleSet(value: unknown): value is RoleColors {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return ROLE_NAMES.every((name) => isHexColor(record[name]));
}

function compose(scheme: ColorScheme, roles: RoleColors): ThemeColors {
  return { ...roles, ...FIXED[scheme], focus: roles.primary };
}

export function resolveTheme(
  scheme: ColorScheme,
  dynamicRoles: unknown,
): ResolvedTheme {
  const fallback = (reason: string | null): ResolvedTheme => ({
    scheme,
    source: 'static',
    colors: compose(scheme, STATIC_ROLES[scheme]),
    fallbackReason: reason,
  });

  if (dynamicRoles === null || dynamicRoles === undefined) {
    return fallback(null);
  }
  if (!isCompleteRoleSet(dynamicRoles)) {
    return fallback('The phone returned an incomplete colour set.');
  }
  const failures = checkRolePairs(dynamicRoles);
  if (failures.length > 0) {
    const first = failures[0];
    const detail = first
      ? `${first.pair.fg} on ${first.pair.bg} is ${first.ratio.toFixed(2)}:1`
      : '';
    return fallback(`Wallpaper colours failed contrast (${detail}).`);
  }
  return {
    scheme,
    source: 'dynamic',
    colors: compose(scheme, dynamicRoles),
    fallbackReason: null,
  };
}

export function gradeColor(colors: ThemeColors, letter: string): string {
  switch (letter) {
    case 'A':
      return colors.gradeA;
    case 'B':
      return colors.gradeB;
    case 'C':
      return colors.gradeC;
    case 'D':
      return colors.gradeD;
    default:
      return colors.gradeE;
  }
}
