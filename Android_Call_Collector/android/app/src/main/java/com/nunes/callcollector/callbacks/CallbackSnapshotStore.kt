package com.nunes.callcollector.callbacks

import android.content.Context
import com.nunes.callcollector.FirebladeDatePolicy
import org.json.JSONArray
import org.json.JSONObject

object CallbackSnapshotStore {
    private const val PREFS = "fireblade_callback_snapshot"
    private const val KEY_JSON = "snapshot_json"
    private const val KEY_UPDATED = "updated_at"
    private const val KEY_ACTIVE = "active_keys"
    private const val KEY_TRACKING_START = "tracking_start"

    fun save(context: Context, summary: CallbackSummary) {
        val array = JSONArray()
        summary.pending.forEach { task ->
            array.put(
                JSONObject()
                    .put("key", task.key)
                    .put("number_raw", task.numberRaw)
                    .put("number_normalized", task.numberNormalized)
                    .put("contact_name", task.contactName ?: JSONObject.NULL)
                    .put("first_miss_at", task.firstMissAt)
                    .put("latest_miss_at", task.latestMissAt)
                    .put("missed_count", task.missedCount)
                    .put("latest_attempt_at", task.latestAttemptAt ?: JSONObject.NULL)
                    .put("ring_seconds", task.ringSeconds)
                    .put("sim_slot_index", task.simSlotIndex ?: JSONObject.NULL)
            )
        }

        val root = JSONObject()
            .put("pending", array)
            .put("resolved_today", summary.resolvedToday)
            .put("generated_at", summary.generatedAt)
            .put("total_incoming", summary.totalIncomingCount)
            .put("answered", summary.answeredCount)
            .put("missed", summary.missedCount)
            .put("selected_day_start", summary.selectedDayStart)

        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_JSON, root.toString())
            .putLong(KEY_UPDATED, summary.generatedAt)
            .putStringSet(KEY_ACTIVE, summary.pending.map { it.key }.toSet())
            .apply()
    }

    fun read(context: Context): CallbackSummary {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_JSON, null)
            ?: return CallbackSummary(emptyList(), 0, 0L)

        return try {
            val root = JSONObject(raw)
            val array = root.optJSONArray("pending") ?: JSONArray()
            val tasks = buildList {
                for (i in 0 until array.length()) {
                    val o = array.getJSONObject(i)
                    add(
                        CallbackTask(
                            key = o.getString("key"),
                            numberRaw = o.optString("number_raw"),
                            numberNormalized = o.optString("number_normalized"),
                            contactName = o.optString("contact_name")
                                .takeIf { it.isNotBlank() && it != "null" },
                            firstMissAt = o.getLong("first_miss_at"),
                            latestMissAt = o.getLong("latest_miss_at"),
                            missedCount = o.getInt("missed_count"),
                            latestAttemptAt = if (o.isNull("latest_attempt_at")) null else o.getLong("latest_attempt_at"),
                            ringSeconds = o.optLong("ring_seconds"),
                            simSlotIndex = if (o.isNull("sim_slot_index")) null else o.getInt("sim_slot_index")
                        )
                    )
                }
            }
            CallbackSummary(
                pending = tasks,
                resolvedToday = root.optInt("resolved_today"),
                generatedAt = root.optLong("generated_at"),
                totalIncomingCount = root.optInt("total_incoming"),
                answeredCount = root.optInt("answered"),
                missedCount = root.optInt("missed"),
                selectedDayStart = root.optLong("selected_day_start")
            )
        } catch (_: Exception) {
            CallbackSummary(emptyList(), 0, 0L)
        }
    }

    fun trackingStart(context: Context): Long {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val existing = prefs.getLong(KEY_TRACKING_START, 0L)
        if (existing > 0L) return existing
        val start = FirebladeDatePolicy.todayStart()
        prefs.edit().putLong(KEY_TRACKING_START, start).apply()
        return start
    }

    fun updatedAt(context: Context): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_UPDATED, 0L)

    fun activeKeys(context: Context): Set<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getStringSet(KEY_ACTIVE, emptySet())?.toSet().orEmpty()

    fun notificationStep(context: Context, key: String): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("notify_${safe(key)}", 0)

    fun setNotificationStep(context: Context, key: String, step: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putInt("notify_${safe(key)}", step).apply()
    }

    fun clearNotificationStep(context: Context, key: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove("notify_${safe(key)}").apply()
    }

    private fun safe(key: String) = key.hashCode().toUInt().toString()
}
