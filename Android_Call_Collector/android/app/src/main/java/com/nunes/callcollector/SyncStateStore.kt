package com.nunes.callcollector

import android.content.Context

class SyncStateStore(context: Context) {
    private val p = context.getSharedPreferences("nunes_sync_state", Context.MODE_PRIVATE)

    var state: String
        get() = p.getString("state", "READY") ?: "READY"
        set(v) = p.edit().putString("state", v).apply()

    var message: String
        get() = p.getString("message", "") ?: ""
        set(v) = p.edit().putString("message", v).apply()

    var lastSuccessfulSyncEpochMs: Long
        get() = p.getLong("last_successful_sync_ms", 0L)
        set(v) = p.edit().putLong("last_successful_sync_ms", v).apply()

    fun set(state: String, message: String = "") {
        p.edit().putString("state", state).putString("message", message).apply()
    }

    fun synced(message: String = "All pending calls uploaded.") {
        p.edit()
            .putString("state", "SYNCED")
            .putString("message", message)
            .putLong("last_successful_sync_ms", System.currentTimeMillis())
            .apply()
    }
}
