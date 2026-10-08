package com.nunes.callcollector.control

import android.content.Context
import com.nunes.callcollector.ConfigStore
import org.json.JSONArray
import org.json.JSONObject

data class MarketingRecipient(
    val employeeId: String,
    val employeeName: String,
    val phoneNumber: String,
    val available: Boolean
)

object ShaneMarketingApi {
    private const val PREFS_NAME = "shane_recipients_cache_prefs"
    private const val KEY_CACHE_JSON = "recipients_json"
    private const val KEY_CACHE_TIMESTAMP = "recipients_timestamp"

    fun load(context: Context, config: ConfigStore): List<MarketingRecipient> {
        val cachedJson = getCachedJson(context)
        val cachedRecipients = if (!cachedJson.isNullOrBlank()) parseRecipients(cachedJson) else emptyList()

        return try {
            val response = DeviceApi.request(
                config,
                DeviceApi.devicePath(config) + "/shane/marketing-recipients"
            )
            val jsonStr = response.toString()
            saveCache(context, jsonStr)
            parseRecipients(jsonStr)
        } catch (e: Exception) {
            if (cachedRecipients.isNotEmpty()) {
                cachedRecipients
            } else {
                throw e
            }
        }
    }

    fun getCachedRecipients(context: Context): List<MarketingRecipient> {
        val cachedJson = getCachedJson(context)
        return if (!cachedJson.isNullOrBlank()) parseRecipients(cachedJson) else emptyList()
    }

    private fun getCachedJson(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_CACHE_JSON, null)
    }

    private fun saveCache(context: Context, jsonStr: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_CACHE_JSON, jsonStr)
            .putLong(KEY_CACHE_TIMESTAMP, System.currentTimeMillis())
            .apply()
    }

    private fun parseRecipients(jsonStr: String): List<MarketingRecipient> {
        return try {
            val response = JSONObject(jsonStr)
            val rows = response.optJSONArray("employees") ?: return emptyList()
            buildList {
                for (index in 0 until rows.length()) {
                    val row = rows.optJSONObject(index) ?: continue
                    val employeeId = row.optString("employee_id", "").trim()
                    val employeeName = row.optString("employee_name", "").trim()
                    val phoneNumber = row.optString("phone_number", "").trim()
                    if (employeeId.isBlank() || employeeName.isBlank()) continue
                    add(
                        MarketingRecipient(
                            employeeId = employeeId,
                            employeeName = employeeName,
                            phoneNumber = phoneNumber,
                            available = row.optBoolean("available", phoneNumber.isNotBlank())
                        )
                    )
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
