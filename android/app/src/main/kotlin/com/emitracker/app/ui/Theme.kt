package com.emitracker.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.emitracker.app.R

/** Design tokens shared with the desktop app (styles.css). */
@Immutable
data class Palette(
    val dark: Boolean,
    val bg: Color, val bg2: Color, val surface: Color, val surface2: Color, val surface3: Color,
    val line: Color, val line2: Color, val text: Color, val text2: Color, val text3: Color,
    val positive: Color, val warning: Color, val danger: Color, val info: Color, val violet: Color, val accent: Color, val heat0: Color,
)

fun darkPalette(accent: Color) = Palette(true, Color(0xFF0B0F17), Color(0xFF0E131D), Color(0xFF121824), Color(0xFF171E2C), Color(0xFF1D2536),
    Color(0x1A94A3B8), Color(0x2E94A3B8), Color(0xFFE6EBF4), Color(0xFFA3AEC2), Color(0xFF6F7B91),
    Color(0xFF34C38F), Color(0xFFF1B44C), Color(0xFFF46A6A), Color(0xFF50A5F1), Color(0xFFA78BFA), accent, Color(0xFF161D2A))

fun lightPalette(accent: Color) = Palette(false, Color(0xFFF5F7FB), Color(0xFFEEF1F7), Color(0xFFFFFFFF), Color(0xFFF7F9FC), Color(0xFFEEF2F8),
    Color(0x140F172A), Color(0x240F172A), Color(0xFF121826), Color(0xFF4A5568), Color(0xFF7A8699),
    Color(0xFF16A36F), Color(0xFFC98A12), Color(0xFFD64545), Color(0xFF2F86D6), Color(0xFF7C5CF0), accent, Color(0xFFECEFF5))

val LocalPalette = staticCompositionLocalOf { darkPalette(Color(0xFF4F8CFF)) }

val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal), Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold), Font(R.font.inter_bold, FontWeight.Bold),
)

private val typography = Typography(
    displaySmall = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 30.sp, letterSpacing = (-0.6).sp),
    headlineSmall = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, letterSpacing = (-0.4).sp),
    titleLarge = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 19.sp, letterSpacing = (-0.3).sp),
    titleMedium = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
    titleSmall = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp),
    bodyLarge = TextStyle(fontFamily = Inter, fontSize = 15.sp, lineHeight = 21.sp),
    bodyMedium = TextStyle(fontFamily = Inter, fontSize = 13.5.sp, lineHeight = 19.sp),
    bodySmall = TextStyle(fontFamily = Inter, fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Medium, fontSize = 13.5.sp),
    labelMedium = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Medium, fontSize = 12.sp),
    labelSmall = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Medium, fontSize = 11.sp, letterSpacing = 0.4.sp),
)

fun parseColor(hex: String, fallback: Color = Color(0xFF4F8CFF)): Color =
    runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(fallback)

@Composable
fun EmiTheme(theme: String, accentHex: String, content: @Composable () -> Unit) {
    val dark = when (theme) { "light" -> false; "dark" -> true; else -> isSystemInDarkTheme() }
    val accent = parseColor(accentHex)
    val p = if (dark) darkPalette(accent) else lightPalette(accent)
    val scheme = if (dark) darkColorScheme(
        primary = accent, onPrimary = Color.White, background = p.bg, onBackground = p.text, surface = p.surface, onSurface = p.text,
        surfaceVariant = p.surface2, onSurfaceVariant = p.text2, surfaceContainer = p.surface, surfaceContainerHigh = p.surface2,
        surfaceContainerHighest = p.surface3, surfaceContainerLow = p.bg2, outline = p.line2, outlineVariant = p.line, error = p.danger,
        secondaryContainer = accent.copy(alpha = 0.18f), onSecondaryContainer = p.text,
    ) else lightColorScheme(
        primary = accent, onPrimary = Color.White, background = p.bg, onBackground = p.text, surface = p.surface, onSurface = p.text,
        surfaceVariant = p.surface2, onSurfaceVariant = p.text2, surfaceContainer = p.surface, surfaceContainerHigh = p.surface2,
        surfaceContainerHighest = p.surface3, surfaceContainerLow = p.bg2, outline = p.line2, outlineVariant = p.line, error = p.danger,
        secondaryContainer = accent.copy(alpha = 0.14f), onSecondaryContainer = p.text,
    )
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = scheme, typography = typography, content = content)
    }
}
