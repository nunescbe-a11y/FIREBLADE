package com.nunes.callcollector.control
import com.nunes.callcollector.ConfigStore
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
class DeviceHttpError(val status: Int) : Exception("Server returned HTTP $status")
object DeviceApi {
    fun request(config: ConfigStore, path: String, body: JSONObject? = null, authenticated: Boolean = true): JSONObject {
        require(config.apiUrl.startsWith("https://")) { "Use the HTTPS Fireblade API URL" }
        if (authenticated) require(config.deviceToken.isNotBlank()) { "Connect this phone in Admin first" }
        val conn = (URL(config.apiUrl + path).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000; readTimeout = 12000; instanceFollowRedirects = false
            requestMethod = if (body == null) "GET" else "POST"
            setRequestProperty("Content-Type", "application/json")
            if (authenticated) setRequestProperty("X-Fireblade-Token", config.deviceToken)
        }
        try {
            if (body != null) { conn.doOutput = true; conn.outputStream.use { it.write(body.toString().toByteArray()) } }
            if (conn.responseCode !in 200..299) throw DeviceHttpError(conn.responseCode)
            val json = conn.inputStream.bufferedReader().use { JSONObject(it.readText()) }
            config.lastServerContact = System.currentTimeMillis()
            return json
        } finally { conn.disconnect() }
    }
    fun devicePath(config: ConfigStore) = "/api/v3/devices/" + java.net.URLEncoder.encode(config.deviceId, "UTF-8")
}
