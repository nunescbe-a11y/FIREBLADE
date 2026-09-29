package com.nunes.callcollector.health

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.nunes.callcollector.ConfigStore
import com.nunes.callcollector.SyncStateStore
import com.nunes.callcollector.data.AppDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object HealthReporter {
    data class UploadResult(val ok: Boolean, val message: String)

    suspend fun upload(context: Context, eventType: String, fast: Boolean = false): UploadResult = withContext(Dispatchers.IO) {
        val config = ConfigStore(context)
        if (config.apiUrl.isBlank() || config.deviceId.isBlank()) {
            return@withContext UploadResult(false, "Device ID / API URL not configured")
        }

        val payload = collect(context, eventType, config)
        val conn = (URL("${config.apiUrl}/api/v1/device-health").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            instanceFollowRedirects = false
            connectTimeout = if (fast) 2500 else 7000
            readTimeout = if (fast) 3000 else 10000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            if (config.deviceToken.isNotBlank() && config.apiUrl.startsWith("https://")) setRequestProperty("X-Fireblade-Token", config.deviceToken)
        }
        return@withContext try {
            conn.outputStream.use { it.write(payload.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code in 200..299) { config.lastServerContact = System.currentTimeMillis(); UploadResult(true, text.ifBlank { "Health uploaded" }) }
            else UploadResult(false, "HTTP $code: $text")
        } catch (e: Exception) {
            UploadResult(false, e.message ?: e.javaClass.simpleName)
        } finally {
            conn.disconnect()
        }
    }

    suspend fun collect(context: Context, eventType: String, config: ConfigStore): JSONObject {
        val now = System.currentTimeMillis()
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        val activeNetwork = connectivity?.activeNetwork
        val caps = activeNetwork?.let { connectivity.getNetworkCapabilities(it) }
        val internetAvailable = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        val wifiConnected = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        val cellularConnected = caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
        val networkType = when {
            caps == null -> "NONE"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
            else -> "OTHER"
        }
        val airplaneMode = try { Settings.Global.getInt(context.contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) == 1 } catch (_: Exception) { false }

        val phonePermission = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        val subscriptionManager = context.getSystemService(SubscriptionManager::class.java)
        val telephonyManager = context.getSystemService(TelephonyManager::class.java)
        val activeSubs = if (phonePermission) {
            try { subscriptionManager?.activeSubscriptionInfoList.orEmpty() } catch (_: Exception) { emptyList() }
        } else emptyList()
        val defaultDataSubId = try { SubscriptionManager.getDefaultDataSubscriptionId() } catch (_: Exception) { -1 }
        val defaultInfo = activeSubs.firstOrNull { it.subscriptionId == defaultDataSubId }
        val defaultDataSimSlot = defaultInfo?.simSlotIndex

        val mobileDataState = when {
            cellularConnected -> "ON"
            else -> try {
                // isDataEnabled() is public from API 26. ACCESS_NETWORK_STATE is
                // sufficient on supported Android versions; if an OEM restricts
                // it, report UNKNOWN instead of guessing OFF.
                val target = if (phonePermission && defaultDataSubId >= 0) {
                    telephonyManager?.createForSubscriptionId(defaultDataSubId)
                } else telephonyManager
                when (target?.isDataEnabled) {
                    true -> "ON"
                    false -> "OFF"
                    else -> "UNKNOWN"
                }
            } catch (_: SecurityException) { "UNKNOWN" }
              catch (_: Exception) { "UNKNOWN" }
        }

        fun simStateForSlot(slot: Int): String {
            if (!phonePermission) return "UNKNOWN"
            return try {
                val info = activeSubs.firstOrNull { it.simSlotIndex == slot }
                if (info != null) "ACTIVE" else when (telephonyManager?.getSimState(slot)) {
                    TelephonyManager.SIM_STATE_READY -> "READY"
                    TelephonyManager.SIM_STATE_ABSENT -> "ABSENT"
                    TelephonyManager.SIM_STATE_PIN_REQUIRED -> "PIN_REQUIRED"
                    TelephonyManager.SIM_STATE_PUK_REQUIRED -> "PUK_REQUIRED"
                    TelephonyManager.SIM_STATE_NETWORK_LOCKED -> "NETWORK_LOCKED"
                    TelephonyManager.SIM_STATE_NOT_READY -> "NOT_READY"
                    TelephonyManager.SIM_STATE_PERM_DISABLED -> "PERM_DISABLED"
                    TelephonyManager.SIM_STATE_CARD_IO_ERROR -> "CARD_IO_ERROR"
                    else -> "UNKNOWN"
                }
            } catch (_: Exception) { "UNKNOWN" }
        }

        val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val batteryPercent = if (level >= 0 && scale > 0) ((level * 100f) / scale).toInt().coerceIn(0, 100) else null
        val batteryStatus = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = batteryStatus == BatteryManager.BATTERY_STATUS_CHARGING || batteryStatus == BatteryManager.BATTERY_STATUS_FULL

        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        val versionName = packageInfo.versionName ?: "unknown"
        val syncState = SyncStateStore(context)
        val pendingUploads = try { AppDatabase.get(context).callDao().pendingCount() } catch (_: Exception) { -1 }
        val bootEpochMs = now - SystemClock.elapsedRealtime()

        return JSONObject().apply {
            put("device_id", config.deviceId)
            put("employee_name", config.employee)
            put("observed_at_epoch_ms", now)
            put("event_type", eventType.uppercase())
            put("mobile_data_state", mobileDataState)
            put("internet_available", internetAvailable)
            put("network_type", networkType)
            put("wifi_connected", wifiConnected)
            put("cellular_connected", cellularConnected)
            put("battery_percent", batteryPercent ?: JSONObject.NULL)
            put("charging", charging)
            put("airplane_mode", airplaneMode)
            put("sim_count", if (phonePermission) activeSubs.size else JSONObject.NULL)
            put("sim1_state", simStateForSlot(0))
            put("sim2_state", simStateForSlot(1))
            put("default_data_sim_slot", defaultDataSimSlot ?: JSONObject.NULL)
            put("apk_version", versionName)
            put("app_version_code", if (Build.VERSION.SDK_INT >= 28) packageInfo.longVersionCode else packageInfo.versionCode.toLong())
            put("permission_state", JSONObject().apply {
                put("call_log", ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED)
                put("contacts", ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED)
                put("phone_state", phonePermission)
                put("notifications", Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            })
            put("android_version", Build.VERSION.RELEASE ?: "")
            put("device_model", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            put("pending_uploads", pendingUploads)
            put("last_call_sync_epoch_ms", syncState.lastSuccessfulSyncEpochMs)
            put("boot_epoch_ms", bootEpochMs)
            put("collector_state", syncState.state)
            put("collector_message", syncState.message)
        }
    }
}
