package com.emitracker.core

/** RFC 4180 CSV writer/reader (port of csv.ts), with spreadsheet formula-injection guarding. */
object Csv {
    private val NUMBER = Regex("^-?\\d+(\\.\\d+)?$")

    fun write(rows: List<List<Any?>>): String = rows.joinToString("\r\n", postfix = "\r\n") { r -> r.joinToString(",") { cell(it) } }

    private fun cell(v: Any?): String {
        if (v == null) return ""
        var s = v.toString()
        if (s.isNotEmpty() && s[0] in "=+-@\t\r" && !NUMBER.matches(s)) s = "'$s"
        return if (s.any { it == '"' || it == ',' || it == '\r' || it == '\n' }) "\"" + s.replace("\"", "\"\"") + "\"" else s
    }

    fun parse(text: String): List<List<String>> {
        val src = if (text.isNotEmpty() && text[0].code == 0xFEFF) text.substring(1) else text // byte-order mark
        val rows = mutableListOf<List<String>>()
        var row = mutableListOf<String>()
        val field = StringBuilder()
        var quoted = false
        var i = 0
        while (i < src.length) {
            val ch = src[i]
            if (quoted) {
                if (ch == '"') { if (i + 1 < src.length && src[i + 1] == '"') { field.append('"'); i++ } else quoted = false } else field.append(ch)
            } else when (ch) {
                '"' -> quoted = true
                ',' -> { row.add(field.toString()); field.clear() }
                '\n', '\r' -> {
                    if (ch == '\r' && i + 1 < src.length && src[i + 1] == '\n') i++
                    row.add(field.toString()); field.clear()
                    if (row.any { it.isNotEmpty() }) rows.add(row)
                    row = mutableListOf()
                }
                else -> field.append(ch)
            }
            i++
        }
        if (field.isNotEmpty() || row.isNotEmpty()) { row.add(field.toString()); if (row.any { it.isNotEmpty() }) rows.add(row) }
        return rows
    }

    fun objects(text: String): List<Map<String, String>> {
        val all = parse(text)
        if (all.isEmpty()) return emptyList()
        val keys = all[0].map { it.trim().lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_') }
        return all.drop(1).map { r -> keys.mapIndexed { i, k -> k to (r.getOrNull(i) ?: "").trim() }.toMap() }
    }
}
