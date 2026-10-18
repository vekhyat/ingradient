import { describe, expect, it } from '@jest/globals';
import {
  Hct,
  MaterialDynamicColors,
  SchemeTonalSpot,
  argbFromHex,
  hexFromArgb,
} from '@material/material-color-utilities';

import { NON_TEXT_MIN, TEXT_MIN, contrastRatio } from './contrast';
import {
  ALLOWED_ROLE_PAIRS,
  checkRolePairs,
  resolveTheme,
} from './resolve-theme';
import { FIXED, STATIC_ROLES, type RoleColors } from './tokens';

/** Builds the role set the Android 14 resources would give for a wallpaper seed. */
function rolesFromSeed(seed: string, isDark: boolean): RoleColors {
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seed)), isDark, 0);
  const role = (color: { getArgb: (s: typeof scheme) => number }) =>
    hexFromArgb(color.getArgb(scheme)).toUpperCase();
  const neutralVariant = scheme.neutralVariantPalette;
  return {
    bg: role(MaterialDynamicColors.surfaceContainerLowest),
    card: role(MaterialDynamicColors.surfaceContainerLow),
    card2: role(MaterialDynamicColors.surfaceContainerHigh),
    ink: role(MaterialDynamicColors.onSurface),
    ink2: role(MaterialDynamicColors.onSurfaceVariant),
    ink3: hexFromArgb(neutralVariant.tone(isDark ? 70 : 40)).toUpperCase(),
    hair: role(MaterialDynamicColors.outlineVariant),
    hair2: role(MaterialDynamicColors.outline),
    primary: role(MaterialDynamicColors.primary),
    onPrimary: role(MaterialDynamicColors.onPrimary),
    primarySoft: role(MaterialDynamicColors.secondaryContainer),
    onPrimarySoft: role(MaterialDynamicColors.onSecondaryContainer),
  };
}

const PALETTE_FIXTURES = {
  forest: '#164E3A',
  yellow: '#F4C430',
  pink: '#E91E63',
  blue: '#1E63E9',
  grey: '#808080',
  nearBlack: '#050505',
  nearWhite: '#FAFAFA',
};

describe('static forest fallback', () => {
  it.each(['light', 'dark'] as const)(
    'passes every allowed role pair in %s mode',
    (scheme) => {
      const failures = checkRolePairs(STATIC_ROLES[scheme]);
      expect(failures).toEqual([]);
    },
  );

  it('measures each allowed pair with the documented minimum', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const pair of ALLOWED_ROLE_PAIRS) {
        const roles = STATIC_ROLES[scheme];
        const ratio = contrastRatio(roles[pair.fg], roles[pair.bg]);
        expect(ratio).toBeGreaterThanOrEqual(pair.min);
      }
    }
  });
});

describe('fixed colours', () => {
  it.each(['light', 'dark'] as const)(
    'keeps white letters readable on every grade fill (%s)',
    (scheme) => {
      const fixed = FIXED[scheme];
      for (const fill of [
        fixed.gradeA,
        fixed.gradeB,
        fixed.gradeC,
        fixed.gradeD,
        fixed.gradeE,
      ]) {
        expect(contrastRatio(fixed.onGrade, fill)).toBeGreaterThanOrEqual(
          TEXT_MIN,
        );
      }
    },
  );

  it.each(['light', 'dark'] as const)(
    'keeps alert text readable on the alert surface (%s)',
    (scheme) => {
      const fixed = FIXED[scheme];
      expect(
        contrastRatio(fixed.alertInk, fixed.alertSurface),
      ).toBeGreaterThanOrEqual(TEXT_MIN);
      expect(
        contrastRatio(fixed.alertBody, fixed.alertSurface),
      ).toBeGreaterThanOrEqual(TEXT_MIN);
      expect(
        contrastRatio(fixed.onCamera, fixed.camera),
      ).toBeGreaterThanOrEqual(TEXT_MIN);
    },
  );

  it('does not let wallpaper colours change grade or alert colours', () => {
    const pink = rolesFromSeed(PALETTE_FIXTURES.pink, false);
    const theme = resolveTheme('light', pink);
    expect(theme.source).toBe('dynamic');
    expect(theme.colors.gradeC).toBe(FIXED.light.gradeC);
    expect(theme.colors.alertInk).toBe(FIXED.light.alertInk);
    expect(theme.colors.camera).toBe(FIXED.light.camera);
  });

  it('gives every badge a 3:1 edge against the page', () => {
    // Light: the fill itself is the edge.
    const light = STATIC_ROLES.light;
    for (const fill of [FIXED.light.gradeA, FIXED.light.gradeE]) {
      expect(contrastRatio(fill, light.bg)).toBeGreaterThanOrEqual(
        NON_TEXT_MIN,
      );
    }
    // Every stamp also carries an ink border, which must hold on every
    // surface in both schemes.
    for (const scheme of ['light', 'dark'] as const) {
      const roles = STATIC_ROLES[scheme];
      for (const surface of [roles.bg, roles.card, roles.card2]) {
        expect(
          contrastRatio(FIXED[scheme].badgeRing, surface),
        ).toBeGreaterThanOrEqual(NON_TEXT_MIN);
      }
    }
  });
});

describe('dynamic wallpaper palettes', () => {
  it.each(Object.entries(PALETTE_FIXTURES))(
    'resolves the %s wallpaper to a fully checked scheme in both modes',
    (_name, seed) => {
      for (const isDark of [false, true]) {
        const theme = resolveTheme(
          isDark ? 'dark' : 'light',
          rolesFromSeed(seed, isDark),
        );
        // Either the whole dynamic scheme passed, or the whole static one is used.
        const roles = theme.colors;
        expect(checkRolePairs(roles)).toEqual([]);
        if (theme.source === 'static') {
          expect(roles.primary).toBe(
            STATIC_ROLES[isDark ? 'dark' : 'light'].primary,
          );
        }
      }
    },
  );
});

describe('whole-scheme fallback', () => {
  it('uses the complete static scheme when one dynamic pair fails', () => {
    const roles = rolesFromSeed(PALETTE_FIXTURES.blue, false);
    const broken = { ...roles, ink3: roles.card };
    const theme = resolveTheme('light', broken);
    expect(theme.source).toBe('static');
    expect(theme.colors.bg).toBe(STATIC_ROLES.light.bg);
    expect(theme.colors.primary).toBe(STATIC_ROLES.light.primary);
    expect(theme.colors.ink3).toBe(STATIC_ROLES.light.ink3);
    expect(theme.fallbackReason).toMatch(/ink3 on/);
  });

  it('rejects an incomplete or malformed colour set', () => {
    const roles = rolesFromSeed(PALETTE_FIXTURES.forest, false);
    const { primary: _primary, ...missing } = roles;
    expect(resolveTheme('light', missing).source).toBe('static');
    expect(resolveTheme('light', { ...roles, bg: 'red' }).source).toBe(
      'static',
    );
    expect(resolveTheme('light', 'not a palette').source).toBe('static');
  });

  it('uses static colours without a reason when the phone has none', () => {
    const theme = resolveTheme('dark', null);
    expect(theme.source).toBe('static');
    expect(theme.fallbackReason).toBeNull();
    expect(theme.colors.focus).toBe(STATIC_ROLES.dark.primary);
  });
});
