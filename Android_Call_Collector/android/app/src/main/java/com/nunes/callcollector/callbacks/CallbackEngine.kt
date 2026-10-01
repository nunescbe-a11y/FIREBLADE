package com.nunes.callcollector.callbacks

import com.nunes.callcollector.FirebladeDatePolicy
import com.nunes.callcollector.data.CallEntity

object CallbackEngine {
    fun dayStart(epochMs: Long = System.currentTimeMillis()): Long =
        FirebladeDatePolicy.startOfDay(epochMs)

    fun nextDayStart(startEpochMs: Long): Long =
        FirebladeDatePolicy.nextDayStart(startEpochMs)

    fun compute(calls: List<CallEntity>, now: Long = System.currentTimeMillis()): CallbackSummary {
        val start = FirebladeDatePolicy.todayStart(now)
        return computeForDay(calls, start, FirebladeDatePolicy.nextDayStart(start), now)
    }

    fun computeForDay(
        calls: List<CallEntity>,
        selectedDayStart: Long,
        selectedDayEnd: Long = FirebladeDatePolicy.nextDayStart(selectedDayStart),
        now: Long = System.currentTimeMillis()
    ): CallbackSummary {
        val start = FirebladeDatePolicy.startOfDay(selectedDayStart)
        val end = selectedDayEnd.takeIf { it > start } ?: FirebladeDatePolicy.nextDayStart(start)
        val selectedCalls = calls.filter { it.startedAtEpochMs >= start && it.startedAtEpochMs < end }
        val incoming = selectedCalls.filter {
            it.direction == "INCOMING_ANSWERED" || it.direction == "INCOMING_MISSED"
        }
        val totalIncoming = incoming.size
        val answered = incoming.count { it.direction == "INCOMING_ANSWERED" }
        val missed = incoming.count { it.direction == "INCOMING_MISSED" }

        val pending = mutableListOf<CallbackTask>()
        var resolved = 0

        calls
            .filter { it.numberNormalized.isNotBlank() || it.numberRaw.isNotBlank() }
            .groupBy { it.numberNormalized.ifBlank { it.numberRaw } }
            .forEach { (key, group) ->
                val openMisses = mutableListOf<CallEntity>()
                var latestAttemptAt: Long? = null

                group.sortedBy { it.startedAtEpochMs }.forEach { call ->
                    when (call.direction) {
                        "INCOMING_MISSED" -> if (call.startedAtEpochMs >= start && call.startedAtEpochMs < end) {
                            openMisses += call
                            if (openMisses.size == 1) latestAttemptAt = null
                        }
                        "OUTGOING_UNANSWERED" -> if (
                            openMisses.isNotEmpty() &&
                            call.startedAtEpochMs > openMisses.last().startedAtEpochMs
                        ) {
                            latestAttemptAt = call.startedAtEpochMs
                        }
                        "OUTGOING_CONNECTED", "INCOMING_ANSWERED" -> if (
                            openMisses.isNotEmpty() &&
                            call.startedAtEpochMs > openMisses.first().startedAtEpochMs
                        ) {
                            resolved++
                            openMisses.clear()
                            latestAttemptAt = null
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
                        contactName = openMisses.asReversed()
                            .firstNotNullOfOrNull { it.contactName?.takeIf { n -> n.isNotBlank() } },
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
            pending = pending.sortedWith(compareBy<CallbackTask> { it.firstMissAt }.thenByDescending { it.missedCount }),
            resolvedToday = resolved,
            generatedAt = now,
            totalIncomingCount = totalIncoming,
            answeredCount = answered,
            missedCount = missed,
            selectedDayStart = start
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
