package com.nunes.callcollector

import android.content.Context

class ConfigStore(context: Context) {
    private val contextRef = context.applicationContext
    private val p = contextRef.getSharedPreferences("nunes_config", Context.MODE_PRIVATE)

    var deviceToken: String
        get() = SecretStore(contextRef).read("device_token")
        set(v) = SecretStore(contextRef).write("device_token", v)

    var pushToken: String
        get() = p.getString("push_token", "") ?: ""
        set(v) = p.edit().putString("push_token", v).apply()

    var lastServerContact: Long
        get() = p.getLong("last_server_contact", 0L)
        set(v) = p.edit().putLong("last_server_contact", v).apply()

    var lastUpdateCheck: Long
        get() = p.getLong("last_update_check", 0L)
        set(v) = p.edit().putLong("last_update_check", v).apply()

    var availableRelease: String
        get() = p.getString("available_release", "") ?: ""
        set(v) = p.edit().putString("available_release", v).apply()

    var deviceId: String
        get() = p.getString("device_id", "") ?: ""
        set(v) = p.edit().putString("device_id", v.trim().uppercase()).apply()

    var employee: String
        get() = p.getString("employee", "") ?: ""
        set(v) = p.edit().putString("employee", v.trim()).apply()

    var apiUrl: String
        get() = p.getString("api_url", "") ?: ""
        set(v) = p.edit().putString("api_url", v.trim().trimEnd('/')).apply()

    var workspaceJson: String
        get() = p.getString("workspace_json", "") ?: ""
        set(v) = p.edit().putString("workspace_json", v).apply()

    var workspaceDate: String
        get() = p.getString("workspace_date", "") ?: ""
        set(v) = p.edit().putString("workspace_date", v).apply()

    var workspaceCachedAt: Long
        get() = p.getLong("workspace_cached_at", 0L)
        set(v) = p.edit().putLong("workspace_cached_at", v).apply()

    var deviceAccessState: String
        get() = p.getString("device_access_state", "UNKNOWN") ?: "UNKNOWN"
        set(v) = p.edit().putString("device_access_state", v).apply()

    var deviceAccessMessage: String
        get() = p.getString("device_access_message", "") ?: ""
        set(v) = p.edit().putString("device_access_message", v).apply()

    fun markDeviceActive() {
        p.edit()
            .putString("device_access_state", "ACTIVE")
            .putString("device_access_message", "")
            .apply()
    }

    fun markDeviceBlocked(message: String) {
        p.edit()
            .putString("device_access_state", "BLOCKED")
            .putString("device_access_message", message.take(300))
            .apply()
    }

    fun clearWorkspaceCache() {
        p.edit()
            .remove("workspace_json")
            .remove("workspace_date")
            .remove("workspace_cached_at")
            .putString("device_access_state", "UNKNOWN")
            .putString("device_access_message", "")
            .apply()
    }
}
