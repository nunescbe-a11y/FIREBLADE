package com.nunes.callcollector

import android.content.Context

class DateSelectionStore(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences("fireblade_date_selection", Context.MODE_PRIVATE)

    fun selectedDayStart(): Long {
        if (prefs.getBoolean("follow_today", true)) return FirebladeDatePolicy.todayStart()
        val stored = prefs.getLong("selected_day_start", FirebladeDatePolicy.todayStart())
        val normalized = FirebladeDatePolicy.startOfDay(stored)
        if (FirebladeDatePolicy.isFuture(normalized)) {
            resetToday()
            return FirebladeDatePolicy.todayStart()
        }
        return normalized
    }

    fun select(dayStartMs: Long): Long {
        val normalized = FirebladeDatePolicy.startOfDay(dayStartMs)
        val safe = if (FirebladeDatePolicy.isFuture(normalized)) FirebladeDatePolicy.todayStart() else normalized
        val today = FirebladeDatePolicy.todayStart()
        prefs.edit()
            .putBoolean("follow_today", safe == today)
            .putLong("selected_day_start", safe)
            .apply()
        return safe
    }

    fun resetToday() {
        prefs.edit()
            .putBoolean("follow_today", true)
            .putLong("selected_day_start", FirebladeDatePolicy.todayStart())
            .apply()
    }
}
