package com.nunes.callcollector

import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.provider.Settings
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.nunes.callcollector.control.EmployeeWorkspace
import com.nunes.callcollector.control.EmployeeWorkspaceApi
import com.nunes.callcollector.databinding.ActivityProfileBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ProfileActivity : AppCompatActivity() {
    private lateinit var b: ActivityProfileBinding
    private val config by lazy { ConfigStore(this) }
    private var profileBitmap: Bitmap? = null
    private var profileKey: String? = null
    private var currentWorkspace: EmployeeWorkspace? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityProfileBinding.inflate(layoutInflater)
        setContentView(b.root)

        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(b.root) { view, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        PremiumNav.bind(this, b.root, PremiumTab.PROFILE)
        b.btnSettings.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
        b.rowAppSettings.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
        b.rowNotifications.setOnClickListener { openNotificationSettings() }
        b.rowPersonal.setOnClickListener { showPersonalInfo() }
        b.rowSim.setOnClickListener { showSimInfo() }
        b.rowAdmin.setOnClickListener {
            AdminGate.unlock(this) {
                startActivity(Intent(this, DeviceAdminActivity::class.java))
            }
        }
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        lifecycleScope.launch {
            val workspace = withContext(Dispatchers.IO) {
                if (config.deviceToken.isNotBlank() && config.apiUrl.startsWith("https://")) {
                    try {
                        EmployeeWorkspaceApi.load(config, FirebladeDatePolicy.todayStart())
                    } catch (_: Exception) {
                        EmployeeWorkspaceApi.loadCached(config, FirebladeDatePolicy.todayStart())
                    }
                } else null
            }
            currentWorkspace = workspace
            render(workspace)
        }
    }

    private fun render(workspace: EmployeeWorkspace?) {
        val employee = workspace?.employeeName?.takeIf { it.isNotBlank() }
            ?: config.employee.takeIf { it.isNotBlank() }
            ?: "Fireblade employee"

        b.tvEmployeeName.text = prettyName(employee)
        b.tvEmployeeMeta.text = if (workspace != null) {
            listOfNotNull(
                workspace.employeeId.takeIf { it.isNotBlank() },
                workspace.departmentName?.takeIf { it.isNotBlank() },
                workspace.currentDeviceId.takeIf { it.isNotBlank() }
            ).joinToString("  \u2022  ")
        } else {
            config.deviceId.ifBlank { "Local employee profile" }
        }

        b.tvSimSummary.text = workspace?.let {
            val current = it.lines.count { line -> line.deviceId.equals(it.currentDeviceId, true) }
            "$current active SIM${if (current == 1) "" else "s"} on this phone"
        } ?: "Company SIM details"

        val initials = employee.split(Regex("\\s+"))
            .filter { it.isNotBlank() }.take(2)
            .mapNotNull { it.firstOrNull()?.uppercaseChar() }
            .joinToString("").ifBlank { "FB" }
        b.tvInitials.text = initials

        val url = workspace?.profilePhotoUrl
        val key = workspace?.profilePhotoUpdatedAt ?: url
        if (url.isNullOrBlank()) {
            profileBitmap = null
            profileKey = key
            b.ivPhoto.setImageDrawable(null)
            b.ivPhoto.visibility = View.GONE
            b.tvInitials.visibility = View.VISIBLE
            return
        }

        if (profileBitmap != null && profileKey == key) {
            b.ivPhoto.setImageBitmap(profileBitmap)
            b.ivPhoto.visibility = View.VISIBLE
            b.tvInitials.visibility = View.GONE
            return
        }

        profileKey = key
        b.ivPhoto.visibility = View.GONE
        b.tvInitials.visibility = View.VISIBLE
        lifecycleScope.launch {
            val bitmap = withContext(Dispatchers.IO) { EmployeeWorkspaceApi.downloadPhoto(url) }
            if (bitmap != null && profileKey == key) {
                profileBitmap = bitmap
                b.ivPhoto.setImageBitmap(bitmap)
                b.ivPhoto.visibility = View.VISIBLE
                b.tvInitials.visibility = View.GONE
            }
        }
    }

    private fun showPersonalInfo() {
        val w = currentWorkspace
        val message = if (w != null) {
            buildString {
                append("Employee ID: ${w.employeeId}\n")
                append("Department: ${w.departmentName ?: "Unassigned"}\n")
                append("Current device: ${w.currentDeviceId}\n")
                append("Active devices: ${w.deviceCount}")
            }
        } else {
            "Employee data will refresh automatically from Fireblade when the server is available."
        }
        MaterialAlertDialogBuilder(this)
            .setTitle(b.tvEmployeeName.text)
            .setMessage(message)
            .setPositiveButton("Close", null)
            .show()
    }

    private fun showSimInfo() {
        val w = currentWorkspace
        if (w == null) {
            MaterialAlertDialogBuilder(this)
                .setTitle("SIM information")
                .setMessage("Company SIM details will refresh automatically from Fireblade.")
                .setPositiveButton("Close", null)
                .show()
            return
        }

        val lines = w.lines.filter { it.deviceId.equals(w.currentDeviceId, true) }
            .sortedBy { it.simSlotIndex ?: Int.MAX_VALUE }

        val message = if (lines.isEmpty()) {
            "No active company SIM is currently assigned to ${w.currentDeviceId}."
        } else {
            lines.joinToString("\n\n") { line ->
                buildString {
                    append(line.lineLabel ?: "SIM ${(line.simSlotIndex ?: 0) + 1}")
                    append("\n${line.phoneNumber}")
                    line.carrierName?.takeIf { it.isNotBlank() }?.let { append("\n$it") }
                }
            }
        }

        MaterialAlertDialogBuilder(this)
            .setTitle("Company SIMs")
            .setMessage(message)
            .setPositiveButton("Close", null)
            .show()
    }

    private fun openNotificationSettings() {
        startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        )
    }

    private fun prettyName(value: String): String =
        value.lowercase().split(Regex("\\s+")).joinToString(" ") { part ->
            part.replaceFirstChar { it.titlecase() }
        }
}
