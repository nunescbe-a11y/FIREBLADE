package com.nunes.callcollector

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

object FirebladeDatePolicy {
    val zone: ZoneId = ZoneId.of("Asia/Kolkata")

    private val dateKeyFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.US)
    private val displayDateFormatter = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH)
    private val displayTimeFormatter = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)
    private val displayDateTimeFormatter = DateTimeFormatter.ofPattern("dd MMM, h:mm a", Locale.ENGLISH)

    fun todayStart(nowMs: Long = System.currentTimeMillis()): Long =
        Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
            .atStartOfDay(zone).toInstant().toEpochMilli()

    fun startOfDay(epochMs: Long): Long =
        Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate()
            .atStartOfDay(zone).toInstant().toEpochMilli()

    fun nextDayStart(dayStartMs: Long): Long =
        Instant.ofEpochMilli(dayStartMs).atZone(zone).toLocalDate().plusDays(1)
            .atStartOfDay(zone).toInstant().toEpochMilli()

    fun fromPicker(year: Int, zeroBasedMonth: Int, day: Int): Long =
        LocalDate.of(year, zeroBasedMonth + 1, day)
            .atStartOfDay(zone).toInstant().toEpochMilli()

    fun dateKey(epochMs: Long): String =
        Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate().format(dateKeyFormatter)

    fun displayDate(epochMs: Long): String =
        Instant.ofEpochMilli(epochMs).atZone(zone).format(displayDateFormatter)

    fun displayTime(epochMs: Long): String =
        Instant.ofEpochMilli(epochMs).atZone(zone).format(displayTimeFormatter)

    fun displayDateTime(epochMs: Long): String =
        Instant.ofEpochMilli(epochMs).atZone(zone).format(displayDateTimeFormatter)

    fun isToday(dayStartMs: Long, nowMs: Long = System.currentTimeMillis()): Boolean =
        startOfDay(dayStartMs) == todayStart(nowMs)

    fun isFuture(dayStartMs: Long, nowMs: Long = System.currentTimeMillis()): Boolean =
        startOfDay(dayStartMs) > todayStart(nowMs)

    fun label(dayStartMs: Long, nowMs: Long = System.currentTimeMillis()): String {
        val normalized = startOfDay(dayStartMs)
        val today = todayStart(nowMs)
        val yesterday = Instant.ofEpochMilli(today).atZone(zone).toLocalDate().minusDays(1)
            .atStartOfDay(zone).toInstant().toEpochMilli()
        return when (normalized) {
            today -> "Today"
            yesterday -> "Yesterday"
            else -> displayDate(normalized)
        }
    }

    fun greeting(nowMs: Long = System.currentTimeMillis()): String {
        val hour = Instant.ofEpochMilli(nowMs).atZone(zone).hour
        return when (hour) {
            in 0..11 -> "Good morning"
            in 12..16 -> "Good afternoon"
            else -> "Good evening"
        }
    }
}
