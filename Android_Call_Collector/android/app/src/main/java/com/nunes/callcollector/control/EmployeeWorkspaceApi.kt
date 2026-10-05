package com.nunes.callcollector.control

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.nunes.callcollector.ConfigStore
import com.nunes.callcollector.FirebladeDatePolicy
import com.nunes.callcollector.callbacks.CallbackSummary
import com.nunes.callcollector.callbacks.CallbackTask
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class EmployeeDevice(
    val deviceId: String,
    val deviceName: String?,
    val phoneLabel: String?
)

data class EmployeeLine(
    val id: Long,
    val deviceId: String,
    val simSlotIndex: Int?,
    val phoneNumber: String,
    val lineLabel: String?,
    val carrierName: String?
)

data class EmployeeCall(
    val callId: Long,
    val deviceId: String,
    val numberRaw: String,
    val numberNormalized: String,
    val contactName: String?,
    val direction: String,
    val startedAtEpochMs: Long,
    val durationSeconds: Long,
    val lineId: Long?,
    val companyPhoneNumber: String?,
    val lineLabel: String?,
    val carrierName: String?,
    val simSlotIndex: Int?
)

data class EmployeeWorkspace(
    val date: String,
    val employeeId: String,
    val employeeName: String,
    val departmentName: String?,
    val profilePhotoUrl: String?,
    val profilePhotoUpdatedAt: String?,
    val currentDeviceId: String,
    val identityRevision: String?,
    val deviceCount: Int,
    val simCount: Int,
    val devices: List<EmployeeDevice>,
    val lines: List<EmployeeLine>,
    val summary: CallbackSummary,
    val calls: List<EmployeeCall>,
    val historySupported: Boolean,
    val historyLimitReached: Boolean
)

object EmployeeWorkspaceApi {
    private fun text(json: JSONObject, key: String): String =
        if (!json.has(key) || json.isNull(key)) "" else json.optString(key, "")

    fun load(config: ConfigStore, selectedDayStart: Long): EmployeeWorkspace {
        val normalizedDay = FirebladeDatePolicy.startOfDay(selectedDayStart)
        val date = FirebladeDatePolicy.dateKey(normalizedDay)
        val path = DeviceApi.devicePath(config) +
            "/employee-workspace?date=" + URLEncoder.encode(date, "UTF-8")
        return try {
            val response = DeviceApi.request(config, path)
            val workspace = parse(response, normalizedDay)
            config.employee = workspace.employeeName
            config.department = workspace.departmentName.orEmpty()
            config.workspaceJson = response.toString()
            config.workspaceDate = date
            config.workspaceCachedAt = System.currentTimeMillis()
            config.markDeviceActive()
            workspace
        } catch (e: DeviceHttpError) {
            if (e.status in listOf(401, 403, 409)) {
                config.markDeviceBlocked(e.message ?: "Device assignment needs Admin attention")
            }
            throw e
        }
    }

    fun loadCached(config: ConfigStore, selectedDayStart: Long): EmployeeWorkspace? {
        val date = FirebladeDatePolicy.dateKey(selectedDayStart)
        if (config.workspaceJson.isBlank() || config.workspaceDate != date) return null
        return try {
            parse(JSONObject(config.workspaceJson), FirebladeDatePolicy.startOfDay(selectedDayStart))
        } catch (_: Exception) {
            null
        }
    }

    fun parse(response: JSONObject, selectedDayStart: Long): EmployeeWorkspace {
        val employee = response.getJSONObject("employee")
        val identity = response.optJSONObject("identity") ?: JSONObject()
        val metrics = response.optJSONObject("metrics") ?: JSONObject()
        val pending = response.optJSONArray("pending_callbacks") ?: JSONArray()
        val lineRows = identity.optJSONArray("lines") ?: JSONArray()
        val deviceRows = identity.optJSONArray("devices") ?: JSONArray()
        val callRows = response.optJSONArray("calls") ?: JSONArray()

        val devices = ArrayList<EmployeeDevice>(deviceRows.length())
        for (i in 0 until deviceRows.length()) {
            val row = deviceRows.optJSONObject(i) ?: continue
            devices += EmployeeDevice(
                deviceId = text(row, "device_id"),
                deviceName = text(row, "device_name").ifBlank { null },
                phoneLabel = text(row, "phone_label").ifBlank { null }
            )
        }

        val lines = ArrayList<EmployeeLine>(lineRows.length())
        for (i in 0 until lineRows.length()) {
            val row = lineRows.optJSONObject(i) ?: continue
            lines += EmployeeLine(
                id = row.optLong("id", 0L),
                deviceId = text(row, "device_id"),
                simSlotIndex = if (row.has("sim_slot_index") && !row.isNull("sim_slot_index")) row.optInt("sim_slot_index") else null,
                phoneNumber = text(row, "phone_number"),
                lineLabel = text(row, "line_label").ifBlank { null },
                carrierName = text(row, "carrier_name").ifBlank { null }
            )
        }

        val tasks = ArrayList<CallbackTask>(pending.length())
        for (i in 0 until pending.length()) {
            val row = pending.getJSONObject(i)
            val raw = text(row, "phone_number_raw")
            val normalized = text(row, "phone_number_normalized")
            val key = text(row, "customer_key").ifBlank {
                normalized.ifBlank { raw.ifBlank { "CALL:$i" } }
            }
            tasks += CallbackTask(
                key = key,
                numberRaw = raw,
                numberNormalized = normalized,
                contactName = text(row, "contact_name").ifBlank { null },
                firstMissAt = row.optLong("first_miss_at_epoch_ms", 0L),
                latestMissAt = row.optLong("latest_miss_at_epoch_ms", 0L),
                missedCount = row.optInt("missed_count", 1).coerceAtLeast(1),
                latestAttemptAt = if (row.has("latest_attempt_at_epoch_ms") && !row.isNull("latest_attempt_at_epoch_ms")) {
                    row.optLong("latest_attempt_at_epoch_ms")
                } else null,
                ringSeconds = row.optLong("ring_seconds", 0L),
                simSlotIndex = if (row.has("sim_slot_index") && !row.isNull("sim_slot_index")) row.optInt("sim_slot_index") else null
            )
        }

        val calls = ArrayList<EmployeeCall>(callRows.length())
        for (i in 0 until callRows.length()) {
            val row = callRows.optJSONObject(i) ?: continue
            calls += EmployeeCall(
                callId = row.optLong("call_id", 0L),
                deviceId = text(row, "device_id"),
                numberRaw = text(row, "phone_number_raw"),
                numberNormalized = text(row, "phone_number_normalized"),
                contactName = text(row, "contact_name").ifBlank { null },
                direction = text(row, "direction"),
                startedAtEpochMs = row.optLong("started_at_epoch_ms", 0L),
                durationSeconds = row.optLong("duration_seconds", 0L),
                lineId = if (row.has("line_id") && !row.isNull("line_id")) row.optLong("line_id") else null,
                companyPhoneNumber = text(row, "company_phone_number").ifBlank { null },
                lineLabel = text(row, "line_label").ifBlank { null },
                carrierName = text(row, "carrier_name").ifBlank { null },
                simSlotIndex = if (row.has("sim_slot_index") && !row.isNull("sim_slot_index")) row.optInt("sim_slot_index") else null
            )
        }

        val summary = CallbackSummary(
            pending = tasks.sortedBy { it.firstMissAt },
            resolvedToday = metrics.optInt("resolved_callbacks", 0),
            totalIncomingCount = metrics.optInt("total_incoming", 0),
            answeredCount = metrics.optInt("answered_calls", 0),
            missedCount = metrics.optInt("missed_calls", 0),
            selectedDayStart = FirebladeDatePolicy.startOfDay(selectedDayStart)
        )

        return EmployeeWorkspace(
            date = text(response, "date").ifBlank { FirebladeDatePolicy.dateKey(selectedDayStart) },
            employeeId = text(employee, "employee_id"),
            employeeName = text(employee, "employee_name"),
            departmentName = text(employee, "department_name").ifBlank { null },
            profilePhotoUrl = text(employee, "profile_photo_url").ifBlank { null },
            profilePhotoUpdatedAt = text(employee, "profile_photo_updated_at").ifBlank { null },
            currentDeviceId = text(identity, "current_device_id"),
            identityRevision = text(identity, "revision").ifBlank { null },
            deviceCount = identity.optInt("device_count", 0),
            simCount = identity.optInt("sim_count", 0),
            devices = devices,
            lines = lines,
            summary = summary,
            calls = calls,
            historySupported = response.has("calls"),
            historyLimitReached = response.optBoolean("history_limit_reached", false)
        )
    }

    fun downloadPhoto(url: String): Bitmap? {
        if (!url.startsWith("https://")) return null
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 7000
            readTimeout = 10000
            instanceFollowRedirects = true
            requestMethod = "GET"
        }
        return try {
            if (conn.responseCode !in 200..299 || !conn.url.protocol.equals("https", ignoreCase = true)) return null
            conn.inputStream.use { BitmapFactory.decodeStream(it) }
        } catch (_: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }
}
