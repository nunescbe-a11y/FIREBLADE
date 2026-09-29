package com.nunes.callcollector.network

import com.nunes.callcollector.ConfigStore
import com.nunes.callcollector.data.CallEntity
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object ApiClient {
    data class SyncResult(val ok: Boolean, val acceptedSourceIds: Set<String>, val message: String)
    private data class HttpResult(val code: Int, val text: String)

    fun upload(config: ConfigStore, calls: List<CallEntity>): SyncResult {
        if (config.apiUrl.isBlank()) return SyncResult(false, emptySet(), "API URL is empty")
        if (config.deviceId.isBlank()) return SyncResult(false, emptySet(), "Device ID is empty")
        if (calls.isEmpty()) return SyncResult(true, emptySet(), "Nothing to upload")

        return try {
            // V1.2 first sends SIM/account metadata. If an older cloud API rejects
            // the additional fields with a validation error, automatically retry
            // the exact same calls using the legacy payload so call collection is
            // never interrupted during a phased server upgrade.
            var http = post(config, buildPayload(config, calls, includeSimMetadata = true))
            var legacyFallback = false
            if (http.code == 400 || http.code == 422) {
                http = post(config, buildPayload(config, calls, includeSimMetadata = false))
                legacyFallback = true
            }

            if (http.code !in 200..299) {
                return SyncResult(false, emptySet(), "HTTP ${http.code}: ${http.text}")
            }

            val json = JSONObject(http.text)
            val ids = mutableSetOf<String>()
            val arr = json.optJSONArray("accepted_source_call_ids") ?: JSONArray()
            for (i in 0 until arr.length()) ids += arr.getString(i)
            val baseMessage = json.optString("message", "Uploaded")
            SyncResult(true, ids, if (legacyFallback) "$baseMessage (legacy cloud compatibility)" else baseMessage)
        } catch (e: Exception) {
            SyncResult(false, emptySet(), e.message ?: e.javaClass.simpleName)
        }
    }

    private fun buildPayload(config: ConfigStore, calls: List<CallEntity>, includeSimMetadata: Boolean): JSONObject = JSONObject().apply {
        put("device_id", config.deviceId)
        put("employee_name", config.employee)
        put("calls", JSONArray().apply {
            calls.forEach { row ->
                put(JSONObject().apply {
                    put("source_call_id", row.sourceCallId)
                    put("phone_number_raw", row.numberRaw)
                    put("phone_number_normalized", row.numberNormalized)
                    put("contact_name", row.contactName ?: JSONObject.NULL)
                    put("direction", row.direction)
                    put("started_at_epoch_ms", row.startedAtEpochMs)
                    put("duration_seconds", row.durationSeconds)
                    if (includeSimMetadata) {
                        put("phone_account_id", row.phoneAccountId ?: JSONObject.NULL)
                        put("phone_account_component", row.phoneAccountComponent ?: JSONObject.NULL)
                        put("subscription_id", row.subscriptionId ?: JSONObject.NULL)
                        put("sim_slot_index", row.simSlotIndex ?: JSONObject.NULL)
                    }
                })
            }
        })
    }

    private fun post(config: ConfigStore, payload: JSONObject): HttpResult {
        val conn = (URL("${config.apiUrl}/api/v1/calls/batch").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10000
            readTimeout = 15000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
        return try {
            conn.outputStream.use { it.write(payload.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            HttpResult(code, text)
        } finally {
            conn.disconnect()
        }
    }
}
