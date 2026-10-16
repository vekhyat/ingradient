package expo.modules.dynamiccolour

import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads the wallpaper-derived Material You colours (Android 12+) and returns
 * them as #RRGGBB strings, so JavaScript can check contrast before using them.
 *
 * Android 14+ exposes finished Material 3 roles (system_surface_container_low_light, ...).
 * Android 12-13 only exposes tonal palettes, so roles are approximated by the
 * nearest published tone. Resources are looked up by name, so a missing
 * resource gives null instead of a crash, and JavaScript falls back to the
 * static forest theme.
 */
class DynamicColourModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DynamicColour")

    Function("getSystemColours") {
      val context = appContext.reactContext ?: return@Function null
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        return@Function null
      }
      val useRoles = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
      val light = resolve(context, if (useRoles) ROLES_LIGHT else PALETTE_LIGHT)
      val dark = resolve(context, if (useRoles) ROLES_DARK else PALETTE_DARK)
      if (light == null || dark == null) {
        return@Function null
      }
      mapOf(
        "method" to if (useRoles) "roles" else "palettes",
        "apiLevel" to Build.VERSION.SDK_INT,
        "light" to light,
        "dark" to dark,
      )
    }
  }

  private fun resolve(context: Context, names: Map<String, String>): Map<String, String>? {
    val result = mutableMapOf<String, String>()
    for ((token, resourceName) in names) {
      val id = context.resources.getIdentifier(resourceName, "color", "android")
      if (id == 0) {
        return null
      }
      val argb = context.getColor(id)
      result[token] = String.format("#%06X", argb and 0xFFFFFF)
    }
    return result
  }

  companion object {
    private val ROLES_LIGHT = mapOf(
      "bg" to "system_surface_container_lowest_light",
      "card" to "system_surface_container_low_light",
      "card2" to "system_surface_container_high_light",
      "ink" to "system_on_surface_light",
      "ink2" to "system_on_surface_variant_light",
      "ink3" to "system_neutral2_600",
      "hair" to "system_outline_variant_light",
      "hair2" to "system_outline_light",
      "primary" to "system_primary_light",
      "onPrimary" to "system_on_primary_light",
      "primarySoft" to "system_secondary_container_light",
      "onPrimarySoft" to "system_on_secondary_container_light",
    )

    private val ROLES_DARK = mapOf(
      "bg" to "system_surface_container_lowest_dark",
      "card" to "system_surface_container_low_dark",
      "card2" to "system_surface_container_high_dark",
      "ink" to "system_on_surface_dark",
      "ink2" to "system_on_surface_variant_dark",
      "ink3" to "system_neutral2_300",
      "hair" to "system_outline_variant_dark",
      "hair2" to "system_outline_dark",
      "primary" to "system_primary_dark",
      "onPrimary" to "system_on_primary_dark",
      "primarySoft" to "system_secondary_container_dark",
      "onPrimarySoft" to "system_on_secondary_container_dark",
    )

    // Tonal palette suffix = 1000 - 10 * tone, so _600 is tone 40.
    private val PALETTE_LIGHT = mapOf(
      "bg" to "system_neutral1_0",
      "card" to "system_neutral1_50",
      "card2" to "system_neutral1_100",
      "ink" to "system_neutral1_900",
      "ink2" to "system_neutral2_700",
      "ink3" to "system_neutral2_600",
      "hair" to "system_neutral2_200",
      "hair2" to "system_neutral2_500",
      "primary" to "system_accent1_600",
      "onPrimary" to "system_accent1_0",
      "primarySoft" to "system_accent2_100",
      "onPrimarySoft" to "system_accent2_900",
    )

    private val PALETTE_DARK = mapOf(
      "bg" to "system_neutral1_1000",
      "card" to "system_neutral1_900",
      "card2" to "system_neutral1_800",
      "ink" to "system_neutral1_100",
      "ink2" to "system_neutral2_200",
      "ink3" to "system_neutral2_300",
      "hair" to "system_neutral2_700",
      "hair2" to "system_neutral2_400",
      "primary" to "system_accent1_200",
      "onPrimary" to "system_accent1_800",
      "primarySoft" to "system_accent2_700",
      "onPrimarySoft" to "system_accent2_100",
    )
  }
}
