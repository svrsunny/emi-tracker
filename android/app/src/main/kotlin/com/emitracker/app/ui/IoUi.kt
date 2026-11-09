package com.emitracker.app.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.io.FileOutputStream
import java.math.BigDecimal
import java.io.OutputStream

/** Save text via the Storage Access Framework (the user picks the location). */
@Composable
fun rememberDocumentWriter(vm: AppViewModel, mime: String, bom: Boolean = false): (String, String) -> Unit {
    val context = LocalContext.current
    var pending by remember { mutableStateOf<String?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(mime)) { uri: Uri? ->
        val text = pending
        pending = null
        if (uri != null && text != null) runCatching {
            context.contentResolver.openOutputStream(uri, "wt")!!.use { out -> if (bom) out.write(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())); out.write(text.toByteArray(Charsets.UTF_8)) }
        }.onSuccess { vm.info("Saved") }.onFailure { vm.error("Could not save: ${it.message}") }
    }
    return { name, content -> pending = content; launcher.launch(name) }
}

@Composable
fun rememberCsvExporter(vm: AppViewModel) = rememberDocumentWriter(vm, "text/csv", bom = true)

/** A tabular report: raw cells (money as "1234.50", dates as ISO) formatted when rendered. */
data class TableReport(
    val title: String, val subtitle: String, val head: List<String>, val rows: List<List<String>>, val note: String? = null,
    val summary: List<Pair<String, String>> = emptyList(), val totals: Boolean = true,
)

/**
 * A4 PDF rendering with android.graphics.pdf (fully local): white page, title block, column
 * widths measured from the content, numbers right-aligned and formatted, landscape for wide
 * tables, the table header repeated on every page, a totals row and "Page x of y".
 */
object PdfReports {
    private val MONEY = Regex("^-?\\d+\\.\\d{2}$")
    private val DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    private val MONTH = Regex("^\\d{4}-\\d{2}$")
    private val NUMBER = Regex("^-?\\d+(\\.\\d+)?$")
    private const val INK = 0xFF14171C.toInt()
    private const val MUTED = 0xFF5B6472.toInt()
    private const val HEAD_INK = 0xFF3B4350.toInt()
    private const val ACCENT = 0xFF1F4FD1.toInt()
    private const val BAND = 0xFFEEF1F6.toInt()
    private const val ZEBRA = 0xFFFAFBFD.toInt()
    private const val RULE = 0xFFE3E6EB.toInt()
    private const val SOFT = 0xFFF5F7FB.toInt()

    fun cell(v: String, fmt: Fmt): String = when {
        MONEY.matches(v) -> fmt.money(v)
        DATE.matches(v) -> fmt.date(v)
        MONTH.matches(v) -> fmt.month(v)
        else -> v
    }

    private fun paint(size: Float, bold: Boolean = false, color: Int = INK) = Paint().apply {
        textSize = size; isAntiAlias = true; this.color = color
        typeface = Typeface.create(Typeface.DEFAULT, if (bold) Typeface.BOLD else Typeface.NORMAL)
    }

    fun write(report: TableReport, fmt: Fmt, out: OutputStream) {
        val cols = report.head.size.coerceAtLeast(1)
        val landscape = cols > 6
        val pw = if (landscape) 842 else 595
        val ph = if (landscape) 595 else 842
        val m = 34f
        val avail = pw - 2 * m
        val isMoney = List(cols) { j -> report.rows.any { MONEY.matches(it.getOrElse(j) { "" }) } }
        val right = List(cols) { j -> isMoney[j] || (report.rows.isNotEmpty() && report.rows.all { val v = it.getOrElse(j) { "" }; v.isEmpty() || NUMBER.matches(v) }) }
        val rows = report.rows.map { r -> List(cols) { j -> cell(r.getOrElse(j) { "" }, fmt) } }
        val totals = if (report.totals && rows.isNotEmpty() && isMoney.drop(1).any { it }) List(cols) { j ->
            when {
                j == 0 -> "Total"
                isMoney[j] -> fmt.money(report.rows.fold(BigDecimal.ZERO) { acc, r -> acc + (r.getOrElse(j) { "" }.toBigDecimalOrNull() ?: BigDecimal.ZERO) }.toPlainString())
                else -> ""
            }
        } else null
        val heads = report.head.map { it.uppercase() }

        // column widths from content; shrink the font, then the text columns, if the table is too wide
        fun natural(sz: Float): FloatArray {
            val b = paint(sz); val bb = paint(sz, bold = true); val h = paint(sz * 0.86f, bold = true)
            return FloatArray(cols) { j ->
                maxOf(h.measureText(heads[j]), rows.maxOfOrNull { b.measureText(it[j]) } ?: 0f, totals?.let { bb.measureText(it[j]) } ?: 0f) + 12f
            }
        }
        var size = 8.6f
        var w = natural(size)
        if (w.sum() > avail) { size = maxOf(6.6f, size * avail / w.sum()); w = natural(size) }
        val textCols = (0 until cols).filter { !right[it] }
        if (w.sum() > avail && textCols.isNotEmpty()) {
            val fixed = (0 until cols).filter { right[it] }.sumOf { w[it].toDouble() }.toFloat()
            val flex = (avail - fixed).coerceAtLeast(textCols.size * 40f)
            val natText = textCols.sumOf { w[it].toDouble() }.toFloat()
            textCols.forEach { w[it] = maxOf(40f, w[it] * flex / natText) }
        }
        if (w.sum() > avail) { val k = avail / w.sum(); for (j in 0 until cols) w[j] *= k }
        else { val total = w.sum(); val extra = avail - total; for (j in 0 until cols) w[j] += extra * w[j] / total }
        val x = FloatArray(cols + 1).also { for (j in 0 until cols) it[j + 1] = it[j] + w[j] }.map { it + m }

        val body = paint(size); val bodyBold = paint(size, bold = true); val head = paint(size * 0.86f, bold = true, color = HEAD_INK)
        val title = paint(17f, bold = true); val sub = paint(9f, color = MUTED); val brand = paint(9f, bold = true, color = ACCENT)
        val statLabel = paint(6.8f, color = MUTED); val statValue = paint(11f, bold = true); val foot = paint(7f, color = MUTED)
        val notePaint = paint(8.4f, color = HEAD_INK)
        val fill = Paint().apply { style = Paint.Style.FILL }
        val line = Paint().apply { strokeWidth = 0.6f; color = RULE }
        val totalRule = Paint().apply { strokeWidth = 1.2f; color = 0xFF8B95A5.toInt() }
        val box = Paint().apply { style = Paint.Style.STROKE; strokeWidth = 0.8f; color = 0xFFE1E5EC.toInt() }
        val rowH = size * 2.0f
        val headH = size * 2.3f
        val noteLines = report.note?.let { wrap(it, avail - 16, notePaint) } ?: emptyList()

        // first page holds the title block, note and summary; later pages start with the table
        val titleBlock = 46f + (if (noteLines.isNotEmpty()) noteLines.size * 11.5f + 14f else 0f) + (if (report.summary.isNotEmpty()) 52f else 0f)
        val tableBottom = ph - m - 18f
        val firstCap = ((tableBottom - (m + titleBlock) - headH) / rowH).toInt().coerceAtLeast(1)
        val restCap = ((tableBottom - m - headH) / rowH).toInt().coerceAtLeast(1)
        val lines = rows.size + (if (totals != null) 1 else 0)
        val pages = if (lines <= firstCap) 1 else 1 + (lines - firstCap + restCap - 1) / restCap

        val doc = PdfDocument()
        var index = 0
        for (pageNo in 1..pages) {
            val page = doc.startPage(PdfDocument.PageInfo.Builder(pw, ph, pageNo).create())
            val c = page.canvas
            var y = m
            if (pageNo == 1) {
                c.drawText(fit(report.title, avail - 90, title), m, y + 15, title)
                c.drawText("EMI Tracker", pw - m - brand.measureText("EMI Tracker"), y + 15, brand)
                c.drawText(fit(report.subtitle, avail, sub), m, y + 30, sub)
                fill.color = ACCENT; c.drawRect(m, y + 37, pw - m, y + 38.6f, fill)
                y += 46f
                if (noteLines.isNotEmpty()) {
                    val hgt = noteLines.size * 11.5f + 6f
                    fill.color = SOFT; c.drawRect(m, y, pw - m, y + hgt, fill)
                    fill.color = 0xFF9AA6B8.toInt(); c.drawRect(m, y, m + 2.5f, y + hgt, fill)
                    noteLines.forEachIndexed { i, t -> c.drawText(t, m + 9, y + 11 + i * 11.5f, notePaint) }
                    y += hgt + 8f
                }
                if (report.summary.isNotEmpty()) {
                    val n = report.summary.size; val gap = 8f; val bw = (avail - gap * (n - 1)) / n
                    report.summary.forEachIndexed { i, (label, value) ->
                        val bx = m + i * (bw + gap)
                        c.drawRoundRect(bx, y, bx + bw, y + 42f, 5f, 5f, box)
                        c.drawText(fit(label.uppercase(), bw - 14, statLabel), bx + 8, y + 14, statLabel)
                        c.drawText(fit(value, bw - 14, statValue), bx + 8, y + 32, statValue)
                    }
                    y += 52f
                }
            }
            // table header, repeated on every page
            fill.color = BAND; c.drawRect(m, y, pw - m, y + headH, fill)
            for (j in 0 until cols) drawCell(c, heads[j], x[j], x[j + 1], y + headH * 0.64f, right[j], head)
            y += headH
            val cap = if (pageNo == 1) firstCap else restCap
            var drawn = 0
            while (drawn < cap && index < lines) {
                val isTotal = totals != null && index == rows.size
                val r = if (isTotal) totals!! else rows[index]
                if (isTotal) { fill.color = SOFT; c.drawRect(m, y, pw - m, y + rowH, fill); c.drawLine(m, y, pw - m, y, totalRule) }
                else if (index % 2 == 1) { fill.color = ZEBRA; c.drawRect(m, y, pw - m, y + rowH, fill) }
                for (j in 0 until cols) drawCell(c, r[j], x[j], x[j + 1], y + rowH * 0.66f, right[j], if (isTotal) bodyBold else body)
                y += rowH
                if (!isTotal) c.drawLine(m, y, pw - m, y, line)
                index++; drawn++
            }
            if (pageNo == 1 && rows.isEmpty()) c.drawText("No data for these filters.", m + 6, y + rowH * 0.8f, sub)
            c.drawText("EMI Tracker · generated on this phone · keep private", m, ph - m + 6, foot)
            val pg = "Page $pageNo of $pages"
            c.drawText(pg, pw - m - foot.measureText(pg), ph - m + 6, foot)
            doc.finishPage(page)
        }
        doc.writeTo(out)
        doc.close()
    }

    private fun drawCell(c: Canvas, text: String, left: Float, right: Float, baseline: Float, alignRight: Boolean, p: Paint) {
        val t = fit(text, right - left - 10, p)
        c.drawText(t, if (alignRight) right - 5 - p.measureText(t) else left + 5, baseline, p)
    }

    private fun wrap(text: String, width: Float, p: Paint): List<String> {
        val out = mutableListOf<String>()
        var cur = ""
        for (word in text.split(' ')) {
            val next = if (cur.isEmpty()) word else "$cur $word"
            if (p.measureText(next) > width && cur.isNotEmpty()) { out += cur; cur = word } else cur = next
        }
        if (cur.isNotEmpty()) out += cur
        return out.take(4)
    }

    private fun fit(s: String, width: Float, p: Paint): String {
        if (p.measureText(s) <= width) return s
        var t = s
        while (t.isNotEmpty() && p.measureText("$t…") > width) t = t.dropLast(1)
        return "$t…"
    }

    /** Send a report to Android's print framework (print or "Save as PDF"). */
    fun print(context: Context, report: TableReport, fmt: Fmt) {
        val pm = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
        pm.print(report.title, object : PrintDocumentAdapter() {
            override fun onLayout(old: PrintAttributes?, new: PrintAttributes?, cancel: CancellationSignal?, cb: LayoutResultCallback, extras: Bundle?) {
                if (cancel?.isCanceled == true) { cb.onLayoutCancelled(); return }
                cb.onLayoutFinished(PrintDocumentInfo.Builder("${report.title}.pdf").setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true)
            }
            override fun onWrite(pages: Array<out PageRange>?, dest: ParcelFileDescriptor, cancel: CancellationSignal?, cb: WriteResultCallback) {
                runCatching { FileOutputStream(dest.fileDescriptor).use { write(report, fmt, it) } }
                    .onSuccess { cb.onWriteFinished(arrayOf(PageRange.ALL_PAGES)) }.onFailure { cb.onWriteFailed(it.message) }
            }
        }, null)
    }
}

@Composable
fun rememberPdfWriter(vm: AppViewModel): (TableReport) -> Unit {
    val fmt = vm.ui.collectAsStateWithLifecycle().value.fmt
    val context = LocalContext.current
    var pending by remember { mutableStateOf<TableReport?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri: Uri? ->
        val r = pending
        pending = null
        if (uri != null && r != null) runCatching { context.contentResolver.openOutputStream(uri, "wt")!!.use { PdfReports.write(r, fmt, it) } }
            .onSuccess { vm.info("PDF saved") }.onFailure { vm.error("Could not save PDF: ${it.message}") }
    }
    return { r -> pending = r; launcher.launch("${r.title}.pdf") }
}
