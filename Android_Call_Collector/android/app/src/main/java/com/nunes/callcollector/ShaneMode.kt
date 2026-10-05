package com.nunes.callcollector

import android.content.Context
import org.json.JSONObject

object ShaneMode {
    fun isEnabled(context: Context): Boolean {
        val config = ConfigStore(context)
        if (config.department.equals("SHANE", ignoreCase = true)) return true
        if (config.workspaceJson.isBlank()) return false
        return try {
            val employee = JSONObject(config.workspaceJson).optJSONObject("employee")
            employee?.optString("department_name", "")?.trim()
                ?.equals("SHANE", ignoreCase = true) == true
        } catch (_: Exception) {
            false
        }
    }
}
