package com.emitracker.app.ui.components

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.emitracker.app.ui.LocalPalette
import com.emitracker.core.RowStatus
import java.time.LocalDate

val CardShape = RoundedCornerShape(16.dp)

@Composable
fun EmiCard(modifier: Modifier = Modifier, title: String? = null, sub: String? = null, action: (@Composable RowScope.() -> Unit)? = null,
            hero: Boolean = false, padding: Dp = 16.dp, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val p = LocalPalette.current
    val heroBrush = if (hero) remember(p) { Brush.linearGradient(listOf(p.accent.copy(alpha = if (p.dark) 0.16f else 0.10f), p.surface, p.surface)) } else null
    Column(
        modifier.fillMaxWidth().clip(CardShape).then(if (heroBrush != null) Modifier.background(heroBrush) else Modifier.background(p.surface)).border(1.dp, p.line, CardShape)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier).padding(padding),
    ) {
        if (title != null || action != null) {
            Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    title?.let { Text(it, style = MaterialTheme.typography.titleSmall, color = p.text, modifier = Modifier.semantics { heading() }) }
                    sub?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = p.text3) }
                }
                action?.invoke(this)
            }
        }
        content()
    }
}

@Composable
fun Stat(label: String, value: String, modifier: Modifier = Modifier, foot: String? = null, tone: Color? = null, large: Boolean = false, tag: (@Composable () -> Unit)? = null, onClick: (() -> Unit)? = null) {
    val p = LocalPalette.current
    EmiCard(modifier, padding = 14.dp, onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = p.text2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, false))
            tag?.invoke()
        }
        Text(value, style = if (large) MaterialTheme.typography.displaySmall else MaterialTheme.typography.titleLarge, color = tone ?: p.text,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
        foot?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = p.text3, modifier = Modifier.padding(top = 2.dp)) }
    }
}

@Composable
fun Tag(text: String, color: Color, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.labelSmall, color = color, modifier = modifier.clip(RoundedCornerShape(6.dp))
        .background(color.copy(alpha = 0.12f)).border(1.dp, color.copy(alpha = 0.28f), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 1.dp))
}

@Composable fun EstimateTag(text: String = "Estimate") = Tag(text, LocalPalette.current.warning, Modifier.semantics { contentDescription = "$text: based on assumed or incomplete data" })
@Composable fun ProjectedTag(text: String = "Projected") = Tag(text, LocalPalette.current.info, Modifier.semantics { contentDescription = "$text: hypothetical future figure" })

@Composable
fun statusColor(s: RowStatus): Color {
    val p = LocalPalette.current
    return when (s) {
        RowStatus.paid, RowStatus.assumed_paid -> p.positive
        RowStatus.prepaid -> p.violet
        RowStatus.due -> p.info
        RowStatus.partially_paid -> p.warning
        RowStatus.overdue, RowStatus.missed -> p.danger
        else -> p.text3
    }
}

@Composable
fun StatusChip(s: RowStatus, modifier: Modifier = Modifier) {
    val c = statusColor(s)
    Row(modifier.semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(c))
        Spacer(Modifier.width(6.dp))
        Text(s.label, style = MaterialTheme.typography.labelMedium, color = c, maxLines = 1)
    }
}

@Composable
fun ProgressLine(pct: Double, color: Color = LocalPalette.current.accent, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    Box(modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(6.dp)).background(p.surface3).semantics { contentDescription = "${"%.1f".format(pct)} percent repaid" }) {
        Box(Modifier.fillMaxWidth((pct / 100).toFloat().coerceIn(0f, 1f)).height(6.dp).clip(RoundedCornerShape(6.dp)).background(color))
    }
}

enum class CalloutKind { Info, Warn, Danger, Ok }

@Composable
fun Callout(text: String, kind: CalloutKind = CalloutKind.Info, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val (c, icon) = when (kind) {
        CalloutKind.Warn -> p.warning to Icons.Outlined.WarningAmber
        CalloutKind.Danger -> p.danger to Icons.Outlined.ErrorOutline
        CalloutKind.Ok -> p.positive to Icons.Outlined.CheckCircle
        CalloutKind.Info -> p.info to Icons.Outlined.Info
    }
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.copy(alpha = 0.08f)).border(1.dp, c.copy(alpha = 0.25f), RoundedCornerShape(12.dp)).padding(12.dp)) {
        Icon(icon, null, tint = c, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = p.text)
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, text: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    val p = LocalPalette.current
    Column(modifier.fillMaxWidth().padding(vertical = 40.dp, horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(p.surface2).border(1.dp, p.line, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = p.accent)
        }
        Spacer(Modifier.height(14.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = p.text)
        Spacer(Modifier.height(4.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = p.text2, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        action?.let { Spacer(Modifier.height(16.dp)); it() }
    }
}

@Composable
fun KvRow(label: String, value: String, valueColor: Color? = null, extra: (@Composable () -> Unit)? = null) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = p.text2, modifier = Modifier.weight(1f))
        extra?.invoke()
        Text(value, style = MaterialTheme.typography.bodyMedium, color = valueColor ?: p.text, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun SectionHeader(title: String, sub: String? = null, modifier: Modifier = Modifier, action: (@Composable RowScope.() -> Unit)? = null) {
    val p = LocalPalette.current
    Row(modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = p.text, modifier = Modifier.semantics { heading() })
            sub?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = p.text3) }
        }
        action?.invoke(this)
    }
}

@Composable
fun <T> Segmented(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    Row(modifier.horizontalScroll(rememberScrollState()).clip(RoundedCornerShape(10.dp)).background(p.surface2).border(1.dp, p.line, RoundedCornerShape(10.dp)).padding(3.dp)) {
        options.forEach { (v, label) ->
            val on = v == selected
            Text(label, style = MaterialTheme.typography.labelMedium, color = if (on) p.text else p.text2, maxLines = 1,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(if (on) p.surface else Color.Transparent)
                    .clickable(role = Role.RadioButton) { onSelect(v) }.semantics { contentDescription = "$label${if (on) ", selected" else ""}" }
                    .padding(horizontal = 12.dp, vertical = 7.dp))
        }
    }
}

@Composable
fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = LocalPalette.current.accent, unfocusedBorderColor = LocalPalette.current.line2,
    focusedContainerColor = LocalPalette.current.bg2, unfocusedContainerColor = LocalPalette.current.bg2,
)

@Composable
fun Field(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier, error: String? = null, hint: String? = null,
          keyboard: KeyboardType = KeyboardType.Text, prefix: String? = null, suffix: String? = null, singleLine: Boolean = true, password: Boolean = false, enabled: Boolean = true) {
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, modifier = modifier.fillMaxWidth(), isError = error != null, singleLine = singleLine,
        enabled = enabled, keyboardOptions = KeyboardOptions(keyboardType = keyboard), colors = fieldColors(), shape = RoundedCornerShape(10.dp),
        prefix = prefix?.let { { Text(it) } }, suffix = suffix?.let { { Text(it) } },
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        supportingText = (error ?: hint)?.let { { Text(it, color = if (error != null) LocalPalette.current.danger else LocalPalette.current.text3) } },
    )
}

@Composable
fun MoneyField(label: String, value: String?, onChange: (String) -> Unit, symbol: String, modifier: Modifier = Modifier, error: String? = null, hint: String? = null) =
    Field(label, value ?: "", { onChange(it.filter { c -> c.isDigit() || c == '.' }) }, modifier, error, hint, KeyboardType.Decimal, prefix = symbol)

@Composable
fun IntField(label: String, value: Int?, onChange: (Int?) -> Unit, modifier: Modifier = Modifier, error: String? = null, hint: String? = null, suffix: String? = null) =
    Field(label, value?.toString() ?: "", { onChange(it.filter(Char::isDigit).take(5).toIntOrNull()) }, modifier, error, hint, KeyboardType.Number, suffix = suffix)

@Composable
fun DateField(label: String, value: String?, onChange: (String?) -> Unit, modifier: Modifier = Modifier, error: String? = null, hint: String? = null, clearable: Boolean = false) {
    val context = LocalContext.current
    val p = LocalPalette.current
    Box(modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value ?: "", onValueChange = {}, readOnly = true, label = { Text(label) }, modifier = Modifier.fillMaxWidth(), isError = error != null,
            trailingIcon = { Icon(Icons.Outlined.CalendarMonth, null) }, colors = fieldColors(), shape = RoundedCornerShape(10.dp),
            supportingText = (error ?: hint)?.let { { Text(it, color = if (error != null) p.danger else p.text3) } },
        )
        Box(Modifier.matchParentSize().clickable(role = Role.Button) {
            val d = value?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now()
            DatePickerDialog(context, { _, y, m, day -> onChange(LocalDate.of(y, m + 1, day).toString()) }, d.year, d.monthValue - 1, d.dayOfMonth).apply {
                if (clearable) setButton(android.content.DialogInterface.BUTTON_NEUTRAL, "Clear") { _, _ -> onChange(null) }
            }.show()
        }.semantics { contentDescription = "$label: ${value ?: "not set"}. Double tap to choose a date." })
    }
}

@Composable
fun TimeField(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Box(modifier.fillMaxWidth()) {
        OutlinedTextField(value = value, onValueChange = {}, readOnly = true, label = { Text(label) }, modifier = Modifier.fillMaxWidth(),
            trailingIcon = { Icon(Icons.Outlined.Schedule, null) }, colors = fieldColors(), shape = RoundedCornerShape(10.dp))
        Box(Modifier.matchParentSize().clickable(role = Role.Button) {
            val (h, m) = value.split(":").map { it.toIntOrNull() ?: 0 }.let { (it.getOrElse(0) { 9 }) to (it.getOrElse(1) { 0 }) }
            TimePickerDialog(context, { _, hh, mm -> onChange("%02d:%02d".format(hh, mm)) }, h, m, true).show()
        }.semantics { contentDescription = "$label: $value. Double tap to change." })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> Dropdown(label: String, value: T, options: List<Pair<T, String>>, onChange: (T) -> Unit, modifier: Modifier = Modifier, hint: String? = null) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }, modifier = modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = options.firstOrNull { it.first == value }?.second ?: "", onValueChange = {}, readOnly = true, label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) }, colors = fieldColors(), shape = RoundedCornerShape(10.dp),
            supportingText = hint?.let { { Text(it, color = LocalPalette.current.text3) } },
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (v, l) -> DropdownMenuItem(text = { Text(l) }, onClick = { onChange(v); open = false }) }
        }
    }
}

@Composable
fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit, hint: String? = null) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().clickable(role = Role.Switch) { onChange(!checked) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge, color = p.text)
            hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = p.text3) }
        }
        Switch(checked = checked, onCheckedChange = null)
    }
}

/** Confirmation dialog; `typeToConfirm` requires typing an exact phrase for destructive actions. */
@Composable
fun ConfirmDialog(title: String, text: String, confirm: String, danger: Boolean = false, typeToConfirm: String? = null, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    var typed by remember { mutableStateOf("") }
    val p = LocalPalette.current
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = p.surface, title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(text, color = p.text2)
                if (typeToConfirm != null) Field("Type “$typeToConfirm” to confirm", typed, { typed = it })
            }
        },
        confirmButton = {
            FilledTonalButton(onClick = onConfirm, enabled = typeToConfirm == null || typed.trim() == typeToConfirm.trim(),
                colors = if (danger) androidx.compose.material3.ButtonDefaults.filledTonalButtonColors(containerColor = p.danger.copy(alpha = 0.2f), contentColor = p.danger) else androidx.compose.material3.ButtonDefaults.filledTonalButtonColors()) { Text(confirm) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun PassphraseDialog(title: String, note: String, confirm: String, onConfirm: (String) -> Unit, onDismiss: () -> Unit, single: Boolean = false) {
    var a by remember { mutableStateOf("") }
    var b by remember { mutableStateOf("") }
    val ok = a.length >= 8 && (single || a == b)
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = LocalPalette.current.surface, title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Field("Passphrase", a, { a = it }, password = true, error = if (a.isNotEmpty() && a.length < 8) "At least 8 characters" else null)
                if (!single) Field("Repeat passphrase", b, { b = it }, password = true, error = if (b.isNotEmpty() && a != b) "Does not match" else null)
                Callout(note, CalloutKind.Warn)
            }
        },
        confirmButton = { FilledTonalButton(onClick = { onConfirm(a) }, enabled = ok) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun Pill(text: String, color: Color, modifier: Modifier = Modifier) {
    Surface(shape = RoundedCornerShape(20.dp), color = color.copy(alpha = 0.16f), border = BorderStroke(0.dp, Color.Transparent), modifier = modifier) {
        Text(text, color = color, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}
