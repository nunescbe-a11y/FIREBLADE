package com.nunes.callcollector

import android.content.Context

class ConfigStore(context: Context) {
    private val p = context.getSharedPreferences("nunes_config", Context.MODE_PRIVATE)
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
    private val contextRef = context.applicationContext
    var deviceId: String
        get() = p.getString("device_id", "") ?: ""
        set(v) = p.edit().putString("device_id", v.trim()).apply()
    var employee: String
        get() = p.getString("employee", "") ?: ""
        set(v) = p.edit().putString("employee", v.trim()).apply()
    var apiUrl: String
        get() = p.getString("api_url", "") ?: ""
        set(v) = p.edit().putString("api_url", v.trim().trimEnd('/')).apply()
}
