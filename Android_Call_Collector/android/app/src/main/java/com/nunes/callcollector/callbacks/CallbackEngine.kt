package com.nunes.callcollector.callbacks

import com.nunes.callcollector.data.CallEntity
import java.util.Calendar

object CallbackEngine {
    fun compute(calls: List<CallEntity>, now: Long = System.currentTimeMillis()): CallbackSummary {
        if (calls.isEmpty()) return CallbackSummary(emptyList(), 0, now)

        val dayStart = Calendar.getInstance().run {
            timeInMillis = now
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            timeInMillis
        }

        val pending = mutableListOf<CallbackTask>()
        var resolvedToday = 0

        calls
            .filter { it.numberNormalized.isNotBlank() || it.numberRaw.isNotBlank() }
            .groupBy { it.numberNormalized.ifBlank { it.numberRaw } }
            .forEach { (key, group) ->
                val ordered = group.sortedBy { it.startedAtEpochMs }
                val openMisses = mutableListOf<CallEntity>()
                var latestAttemptAt: Long? = null

                ordered.forEach { call ->
                    when (call.direction) {
                        "INCOMING_MISSED" -> {
                            openMisses += call
                            if (openMisses.size == 1) latestAttemptAt = null
                        }
                        "OUTGOING_UNANSWERED" -> {
                            if (openMisses.isNotEmpty()) latestAttemptAt = call.startedAtEpochMs
                        }
                        "OUTGOING_CONNECTED" -> {
                            if (openMisses.isNotEmpty()) {
                                if (call.startedAtEpochMs >= dayStart) resolvedToday++
                                openMisses.clear()
                                latestAttemptAt = null
                            }
                        }
                    }
                }

                if (openMisses.isNotEmpty()) {
                    val first = openMisses.first()
                    val latest = openMisses.last()
                    pending += CallbackTask(
                        key = key,
                        numberRaw = latest.numberRaw.ifBlank { first.numberRaw },
                        numberNormalized = latest.numberNormalized.ifBlank { first.numberNormalized },
                        contactName = openMisses.asReversed().firstNotNullOfOrNull { it.contactName?.takeIf { name -> name.isNotBlank() } },
                        firstMissAt = first.startedAtEpochMs,
                        latestMissAt = latest.startedAtEpochMs,
                        missedCount = openMisses.size,
                        latestAttemptAt = latestAttemptAt?.takeIf { it > latest.startedAtEpochMs },
                        ringSeconds = latest.durationSeconds,
                        simSlotIndex = latest.simSlotIndex
                    )
                }
            }

        return CallbackSummary(
            pending = pending.sortedWith(
                compareBy<CallbackTask> { it.firstMissAt }.thenByDescending { it.missedCount }
            ),
            resolvedToday = resolvedToday,
            generatedAt = now
        )
    }

    fun ageText(epochMs: Long, now: Long = System.currentTimeMillis()): String {
        val minutes = ((now - epochMs).coerceAtLeast(0L) / 60_000L).toInt()
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "${minutes}m"
            minutes < 24 * 60 -> "${minutes / 60}h ${minutes % 60}m"
            else -> "${minutes / (24 * 60)}d ${(minutes % (24 * 60)) / 60}h"
        }
    }
}
