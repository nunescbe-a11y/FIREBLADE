package com.nunes.callcollector

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.nunes.callcollector.callbacks.FollowUpNotifier
import com.nunes.callcollector.databinding.ActivitySettingsBinding

class SettingsActivity : AppCompatActivity() {
    private lateinit var b: ActivitySettingsBinding
    private val config by lazy { ConfigStore(this) }

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            refreshNotificationState()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(b.root)

        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(b.root) { view, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        b.btnBack.setOnClickListener { finish() }
        b.btnAdvancedAdmin.setOnClickListener {
            AdminGate.unlock(this) {
                startActivity(Intent(this, DeviceAdminActivity::class.java))
            }
        }

        b.switchIncoming.visibility = android.view.View.GONE
        b.switchMissed.visibility = android.view.View.GONE

        b.switchCallbacks.setOnCheckedChangeListener { _, checked ->
            if (checked && !FollowUpNotifier.notificationsAllowed(this)) {
                if (
                    Build.VERSION.SDK_INT >= 33 &&
                    ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                ) {
                    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    openNotificationSettings()
                }
            } else if (!checked && FollowUpNotifier.notificationsAllowed(this)) {
                openNotificationSettings()
            }
        }

        val info = packageManager.getPackageInfo(packageName, 0)
        @Suppress("DEPRECATION")
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
        b.tvVersion.text = "${info.versionName ?: "Unknown"} (Code $code)"
        b.tvSettingsStatus.text = when (config.deviceAccessState) {
            "BLOCKED" -> config.deviceAccessMessage.ifBlank { "Admin action required" }
            "ACTIVE" -> "Employee identity and SIM details are controlled by Fireblade Web."
            else -> "Fireblade will refresh employee and device configuration automatically."
        }
    }

    override fun onResume() {
        super.onResume()
        refreshNotificationState()
    }

    private fun refreshNotificationState() {
        b.switchCallbacks.setOnCheckedChangeListener(null)
        b.switchCallbacks.isChecked = FollowUpNotifier.notificationsAllowed(this)
        b.switchCallbacks.setOnCheckedChangeListener { _, checked ->
            if (checked && !FollowUpNotifier.notificationsAllowed(this)) {
                if (
                    Build.VERSION.SDK_INT >= 33 &&
                    ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                ) {
                    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else openNotificationSettings()
            } else if (!checked && FollowUpNotifier.notificationsAllowed(this)) {
                openNotificationSettings()
            }
        }
    }

    private fun openNotificationSettings() {
        startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        )
    }
}
