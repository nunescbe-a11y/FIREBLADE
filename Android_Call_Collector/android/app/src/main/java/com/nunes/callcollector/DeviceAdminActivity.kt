package com.nunes.callcollector

import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.nunes.callcollector.control.AppUpdater
import com.nunes.callcollector.control.DeviceApi
import com.nunes.callcollector.control.EmployeeWorkspaceApi
import com.nunes.callcollector.control.UpdateWorker
import com.nunes.callcollector.databinding.ActivityDeviceAdminBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class DeviceAdminActivity : AppCompatActivity() {
    private lateinit var b: ActivityDeviceAdminBinding
    private val config by lazy { ConfigStore(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityDeviceAdminBinding.inflate(layoutInflater)
        setContentView(b.root)

        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(b.root) { view, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        b.btnBack.setOnClickListener { finish() }
        b.btnEnroll.setOnClickListener { enroll() }
        b.btnRefreshWorkspace.setOnClickListener { refreshWorkspace() }
        b.btnCheckUpdate.setOnClickListener { checkUpdate() }
        b.btnInstallUpdate.setOnClickListener {
            if (AppUpdater.ready(this)) AppUpdater.install(this) else checkUpdate()
        }

        render()
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun render() {
        val enrolled = config.deviceToken.isNotBlank()
        b.tvAdminDeviceId.text = config.deviceId.ifBlank { "Not configured" }
        b.tvAdminEmployee.text = config.employee.ifBlank { "Waiting for server assignment" }
        b.tvAdminApi.text = config.apiUrl.ifBlank { "Not configured" }
        b.tvAdminState.text = when (config.deviceAccessState) {
            "ACTIVE" -> "Connected and assigned"
            "BLOCKED" -> config.deviceAccessMessage.ifBlank { "Admin action required" }
            else -> if (enrolled) "Connected - waiting for workspace verification" else "Not enrolled"
        }

        val info = packageManager.getPackageInfo(packageName, 0)
        @Suppress("DEPRECATION")
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
        b.tvAdminVersion.text = "${info.versionName ?: "Unknown"} (Code $code)"

        b.setupPanel.visibility = if (enrolled) View.GONE else View.VISIBLE
        if (!enrolled) {
            if (b.etSetupDeviceId.text.isNullOrBlank()) b.etSetupDeviceId.setText(config.deviceId)
            if (b.etSetupApiUrl.text.isNullOrBlank()) b.etSetupApiUrl.setText(config.apiUrl)
        }

        b.btnInstallUpdate.visibility = if (config.availableRelease.isNotBlank()) View.VISIBLE else View.GONE
        b.btnInstallUpdate.text = if (AppUpdater.ready(this)) "Install verified update" else "Download update"
    }

    private fun enroll() {
        val deviceId = b.etSetupDeviceId.text?.toString().orEmpty().trim().uppercase()
        val apiUrl = b.etSetupApiUrl.text?.toString().orEmpty().trim().trimEnd('/')
        val code = b.etEnrollmentCode.text?.toString().orEmpty().trim()

        if (!deviceId.matches(Regex("[A-Z0-9_-]{1,100}"))) {
            b.tvAdminMessage.text = "Enter a valid Fireblade Device ID."
            return
        }
        if (!apiUrl.startsWith("https://")) {
            b.tvAdminMessage.text = "Fireblade API must use HTTPS."
            return
        }
        if (code.isBlank()) {
            b.tvAdminMessage.text = "Enter the one-time enrollment code from Fireblade Web."
            return
        }

        b.btnEnroll.isEnabled = false
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    if (config.deviceId != deviceId || config.apiUrl != apiUrl) {
                        config.deviceToken = ""
                        config.clearWorkspaceCache()
                    }
                    config.deviceId = deviceId
                    config.apiUrl = apiUrl

                    val response = DeviceApi.request(
                        config,
                        "/api/v3/enroll",
                        JSONObject().put("device_id", deviceId).put("code", code),
                        authenticated = false
                    )
                    config.deviceToken = response.getString("device_token")
                    EmployeeWorkspaceApi.load(config, FirebladeDatePolicy.todayStart())
                }

                b.etEnrollmentCode.text?.clear()
                b.tvAdminMessage.text = "Enrollment verified. Fireblade Web now controls employee identity and SIM assignments."
                com.nunes.callcollector.callbacks.CallbackRefreshWorker.enqueue(this@DeviceAdminActivity)
                AutomationScheduler.enqueueHealth(this@DeviceAdminActivity, "CONFIG_SAVED")
                UpdateWorker.now(this@DeviceAdminActivity)
                render()
            } catch (e: Exception) {
                b.tvAdminMessage.text = e.message ?: "Enrollment failed"
            } finally {
                b.btnEnroll.isEnabled = true
            }
        }
    }

    private fun refreshWorkspace() {
        if (config.deviceToken.isBlank()) {
            b.tvAdminMessage.text = "Enroll this phone first."
            return
        }

        b.btnRefreshWorkspace.isEnabled = false
        lifecycleScope.launch {
            try {
                val workspace = withContext(Dispatchers.IO) {
                    EmployeeWorkspaceApi.load(config, FirebladeDatePolicy.todayStart())
                }
                b.tvAdminMessage.text =
                    "Verified ${workspace.employeeName} - ${workspace.currentDeviceId} - ${workspace.simCount} active SIM${if (workspace.simCount == 1) "" else "s"}."
                render()
            } catch (e: Exception) {
                b.tvAdminMessage.text = e.message ?: "Workspace refresh failed"
            } finally {
                b.btnRefreshWorkspace.isEnabled = true
            }
        }
    }

    private fun checkUpdate() {
        if (config.deviceToken.isBlank()) {
            b.tvAdminMessage.text = "Enroll this phone before checking for updates."
            return
        }

        b.btnCheckUpdate.isEnabled = false
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { AppUpdater.checkAndDownload(this@DeviceAdminActivity) }
                b.tvAdminMessage.text =
                    if (config.availableRelease.isBlank()) "This phone is up to date."
                    else if (AppUpdater.ready(this@DeviceAdminActivity)) "Verified update ready to install."
                    else "Update available."
                render()
            } catch (e: Exception) {
                b.tvAdminMessage.text = e.message ?: "Update check failed"
            } finally {
                b.btnCheckUpdate.isEnabled = true
            }
        }
    }
}
