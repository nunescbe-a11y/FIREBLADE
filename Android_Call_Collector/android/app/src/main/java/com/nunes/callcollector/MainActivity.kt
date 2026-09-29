package com.nunes.callcollector

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.nunes.callcollector.callbacks.CallbackEngine
import com.nunes.callcollector.callbacks.CallbackRefreshWorker
import com.nunes.callcollector.callbacks.CallbackSummary
import com.nunes.callcollector.callbacks.CallbackTask
import com.nunes.callcollector.callbacks.FollowUpNotifier
import com.nunes.callcollector.control.AppUpdater
import com.nunes.callcollector.control.CommandWorker
import com.nunes.callcollector.control.DeviceApi
import com.nunes.callcollector.control.UpdateWorker
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.databinding.ActivityMainBinding
import com.nunes.callcollector.health.HealthReporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var b: ActivityMainBinding
    private val config by lazy { ConfigStore(this) }
    private val handler = Handler(Looper.getMainLooper())
    private var refreshing = false
    private var showAllCallbacks = false
    private var focusNumber: String? = null

    private val refresh = object : Runnable {
        override fun run() {
            refreshUi()
            handler.postDelayed(this, 30_000L)
        }
    }

    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        AutomationScheduler.enqueueCapture(this, 1)
        AutomationScheduler.enqueueHealth(this, "PERMISSIONS_CHANGED")
        CallbackRefreshWorker.enqueue(this)
        refreshUi()
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        refreshAlertCard()
        if (it) {
            CallbackRefreshWorker.enqueue(this)
            b.tvStatus.text = "Follow-up alerts enabled."
        } else {
            b.tvStatus.text = "Follow-up alerts are off. You can enable them later."
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)

        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(b.root) { view, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        focusNumber = intent.getStringExtra("focus_number")
        bindAdminValues()
        bindActions()

        FollowUpNotifier.ensureChannel(this)
        AutomationScheduler.schedulePeriodicReconciliation(this)
        AutomationScheduler.enqueueCapture(this, 1)
        AutomationScheduler.enqueueHealth(this, "APP_OPEN", 1)
        AutomationScheduler.scheduleNextHealthPulse(this)
        CommandWorker.enqueue(this)
        UpdateWorker.schedule(this)
        UpdateWorker.now(this)
        CallbackRefreshWorker.enqueue(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        focusNumber = intent.getStringExtra("focus_number")
        refreshUi()
    }

    override fun onResume() {
        super.onResume()
        handler.removeCallbacks(refresh)
        handler.post(refresh)
        refreshAlertCard()
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        b.adminPanel.visibility = View.GONE
        super.onPause()
    }

    private fun bindAdminValues() {
        b.etDeviceId.setText(config.deviceId)
        b.etEmployee.setText(config.employee)
        b.etApiUrl.setText(config.apiUrl)
    }

    private fun bindActions() {
        b.btnAdmin.setOnClickListener { AdminGate.unlock(this) { b.adminPanel.visibility = View.VISIBLE } }
        b.btnCloseAdmin.setOnClickListener { b.adminPanel.visibility = View.GONE }
        b.btnSaveConfig.setOnClickListener { saveConfig() }
        b.btnConnect.setOnClickListener { connect() }

        b.btnPermissions.setOnClickListener {
            permissions.launch(
                arrayOf(
                    Manifest.permission.READ_CALL_LOG,
                    Manifest.permission.READ_CONTACTS,
                    Manifest.permission.READ_PHONE_STATE
                )
            )
        }

        b.btnScan.setOnClickListener {
            AutomationScheduler.enqueueCapture(this)
            b.tvAdminMessage.text = "Call-log check requested"
        }

        b.btnSync.setOnClickListener {
            AutomationScheduler.enqueueCapture(this)
            AutomationScheduler.enqueueSync(this)
            CommandWorker.enqueue(this)
            AutomationScheduler.enqueueHealth(this, "APP_OPEN")
            CallbackRefreshWorker.enqueue(this)
            b.tvStatus.text = "Sync requested…"
        }

        b.btnReviewCallbacks.setOnClickListener {
            b.callbackSection.requestFocus()
            b.root.smoothScrollTo(0, b.callbackSection.top)
        }

        b.btnViewAllCallbacks.setOnClickListener {
            showAllCallbacks = !showAllCallbacks
            refreshUi()
        }

        b.btnEnableAlerts.setOnClickListener {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                CallbackRefreshWorker.enqueue(this)
                b.tvStatus.text = "Follow-up alerts are active."
                refreshAlertCard()
            }
        }

        b.btnCheckUpdate.setOnClickListener { checkForUpdateNow() }

        b.btnUpdate.setOnClickListener {
            if (AppUpdater.ready(this)) {
                lifecycleScope.launch {
                    b.btnUpdate.isEnabled = false
                    try {
                        val release = JSONObject(config.availableRelease)
                        withContext(Dispatchers.IO) {
                            AppUpdater.verify(
                                this@MainActivity,
                                java.io.File(cacheDir, "updates/fireblade.apk"),
                                release
                            )
                        }
                        AppUpdater.install(this@MainActivity)
                        b.tvUpdateStatus.text = "Ready to install"
                        b.tvStatus.text = "Approve the Android update prompt to finish the Fireblade update."
                    } catch (e: Exception) {
                        b.tvStatus.text = e.message ?: "Unable to open update"
                    } finally {
                        b.btnUpdate.isEnabled = true
                    }
                }
            } else {
                checkForUpdateNow()
            }
        }
    }

    private fun saveConfig(): Boolean {
        val id = b.etDeviceId.text.toString().trim().uppercase()
        val url = b.etApiUrl.text.toString().trim().trimEnd('/')
        if (!id.matches(Regex("[A-Z0-9_-]{1,100}")) ||
            !url.startsWith("https://") ||
            android.net.Uri.parse(url).host.isNullOrBlank()
        ) {
            b.tvAdminMessage.text = "Enter a registered device ID and HTTPS API URL"
            return false
        }
        if (config.deviceId != id || config.apiUrl != url) {
            config.deviceToken = ""
            config.lastServerContact = 0
            config.availableRelease = ""
        }
        config.deviceId = id
        config.employee = b.etEmployee.text.toString()
        config.apiUrl = url
        AutomationScheduler.enqueueCapture(this, 1)
        AutomationScheduler.enqueueHealth(this, "CONFIG_SAVED", 2)
        CallbackRefreshWorker.enqueue(this)
        b.tvAdminMessage.text = "Settings saved"
        return true
    }

    private fun connect() {
        if (!saveConfig()) return
        val code = b.etEnrollmentCode.text.toString().trim()
        if (code.isBlank()) {
            b.tvAdminMessage.text = "Enter the one-time code from Fireblade Web → App Updates"
            return
        }
        b.btnConnect.isEnabled = false
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val response = DeviceApi.request(
                        config,
                        "/api/v3/enroll",
                        JSONObject().put("device_id", config.deviceId).put("code", code),
                        false
                    )
                    config.deviceToken = response.getString("device_token")
                }
                b.etEnrollmentCode.text?.clear()
                b.tvAdminMessage.text = "Phone connected"
                CommandWorker.enqueue(this@MainActivity)
                UpdateWorker.now(this@MainActivity)
                AutomationScheduler.enqueueHealth(this@MainActivity, "CONFIG_SAVED")
            } catch (e: Exception) {
                b.tvAdminMessage.text = e.message ?: "Connection failed"
            } finally {
                b.btnConnect.isEnabled = true
            }
        }
    }

    private fun checkForUpdateNow() {
        if (config.deviceToken.isBlank()) {
            b.tvUpdateStatus.text = "Connection required"
            b.tvReleaseNotes.text = "Connect this phone once in Admin before checking for Fireblade updates."
            return
        }
        lifecycleScope.launch {
            b.btnCheckUpdate.isEnabled = false
            b.tvUpdateStatus.text = "Checking…"
            b.tvReleaseNotes.text = "Looking for the latest approved Fireblade release."
            try {
                withContext(Dispatchers.IO) { AppUpdater.checkAndDownload(this@MainActivity) }
                if (config.availableRelease.isBlank()) {
                    b.tvUpdateStatus.text = "Up to date"
                    b.tvReleaseNotes.text = "You already have the latest Fireblade version."
                } else {
                    val release = JSONObject(config.availableRelease)
                    b.tvUpdateStatus.text = "Update ready"
                    b.tvReleaseNotes.text = release.optString("notes").ifBlank {
                        "Fireblade ${release.optString("version_name")} is ready to install."
                    }
                }
            } catch (e: Exception) {
                b.tvUpdateStatus.text = "Check failed"
                b.tvReleaseNotes.text = e.message ?: "Unable to check for updates right now."
            } finally {
                b.btnCheckUpdate.isEnabled = true
                renderUpdateState()
            }
        }
    }

    private fun refreshUi() {
        if (refreshing) return
        refreshing = true
        lifecycleScope.launch {
            try {
                val data = withContext(Dispatchers.IO) {
                    val dao = AppDatabase.get(this@MainActivity).callDao()
                    val snapshot = HealthReporter.collect(this@MainActivity, "UI", config)
                    val uploadPending = dao.pendingCount()
                    val trackingStart = com.nunes.callcollector.callbacks.CallbackSnapshotStore.trackingStart(this@MainActivity)
                    val callbackSummary = CallbackEngine.compute(dao.latest(10_000).filter { it.startedAtEpochMs >= trackingStart })
                    Triple(snapshot, uploadPending, callbackSummary)
                }
                renderEmployeeDashboard(data.first, data.second, data.third)
            } catch (e: Exception) {
                b.tvStatus.text = e.message ?: "Status unavailable"
            } finally {
                refreshing = false
            }
        }
    }

    private fun renderEmployeeDashboard(snapshot: JSONObject, uploadPending: Int, callbackSummary: CallbackSummary) {
        val now = System.currentTimeMillis()
        val employee = config.employee.trim()
        val greeting = when (Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) {
            in 0..11 -> "Good morning"
            in 12..16 -> "Good afternoon"
            else -> "Good evening"
        }
        b.tvGreeting.text = if (employee.isBlank()) greeting else "$greeting, ${employee.split(" ").joinToString(" ") { part -> part.lowercase().replaceFirstChar { it.titlecase() } }}"
        b.tvGreetingSub.text = when {
            callbackSummary.pendingCount == 0 -> "You are all caught up. Fireblade will keep watching for missed customer calls."
            callbackSummary.overdueCount > 0 -> "${callbackSummary.overdueCount} callback${if (callbackSummary.overdueCount == 1) " needs" else "s need"} attention now."
            else -> "You have ${callbackSummary.pendingCount} customer callback${if (callbackSummary.pendingCount == 1) "" else "s"} waiting."
        }

        b.tvWorkspaceSub.text = buildString {
            append(config.deviceId.ifBlank { "Setup needed" })
            if (config.deviceToken.isNotBlank()) append("  •  Connected")
        }

        val internet = snapshot.optBoolean("internet_available")
        val recentServer = config.lastServerContact > 0 && now - config.lastServerContact < 12L * 60L * 1000L
        b.tvSyncBadge.text = when {
            !internet -> "Offline"
            uploadPending > 0 -> "Syncing"
            recentServer -> "Synced"
            else -> "Ready"
        }
        b.tvSyncBadge.setTextColor(
            ContextCompat.getColor(
                this,
                if (!internet) android.R.color.holo_red_dark else android.R.color.holo_green_dark
            )
        )

        b.tvPendingCount.text = callbackSummary.pendingCount.toString()
        b.tvPendingLabel.text = if (callbackSummary.pendingCount == 0) "All caught up" else "customer${if (callbackSummary.pendingCount == 1) "" else "s"} waiting"
        b.tvOverdue.text = when {
            callbackSummary.pendingCount == 0 -> "No pending follow-ups"
            callbackSummary.overdueCount == 0 -> "Nothing overdue"
            else -> "${callbackSummary.overdueCount} overdue more than 2 hours"
        }
        b.tvResolvedToday.text = callbackSummary.resolvedToday.toString()

        val last = SyncStateStore(this).lastSuccessfulSyncEpochMs
        b.tvLastSyncCompact.text = if (last > 0) SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(last)) else "Not yet"
        b.tvStatus.text = when {
            !internet -> "Offline — showing saved callback information. Fireblade will sync automatically."
            uploadPending > 0 -> "$uploadPending call${if (uploadPending == 1) "" else "s"} waiting to sync."
            last > 0 -> "Calls synchronized ${SimpleDateFormat("dd MMM, h:mm a", Locale.getDefault()).format(Date(last))}."
            else -> "Fireblade is ready."
        }

        renderCallbacks(callbackSummary)
        refreshAlertCard()
        renderUpdateState()

        val allowed = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED
        b.tvPermissions.text = buildString {
            append("Call log: ${if (allowed) "Granted" else "Required"}")
            append("\nRemote checks: ${if (config.deviceToken.isBlank()) "Connect this phone" else "Enrolled"}")
            append("\nApp: ${installedVersionText()}")
            append("\nInternet: ${if (internet) "Available" else "Unavailable"}")
        }
    }

    private fun renderCallbacks(summary: CallbackSummary) {
        b.callbackList.removeAllViews()
        b.emptyCallbacks.visibility = if (summary.pending.isEmpty()) View.VISIBLE else View.GONE
        b.tvCallbackSectionHint.visibility = if (summary.pending.isEmpty()) View.GONE else View.VISIBLE

        val visible = if (showAllCallbacks) summary.pending else summary.pending.take(5)
        visible.forEachIndexed { index, task ->
            val view = LayoutInflater.from(this).inflate(R.layout.callback_task_card, b.callbackList, false)
            val name = view.findViewById<TextView>(R.id.tvCallbackName)
            val number = view.findViewById<TextView>(R.id.tvCallbackNumber)
            val badge = view.findViewById<TextView>(R.id.tvCallbackBadge)
            val meta = view.findViewById<TextView>(R.id.tvCallbackMeta)
            val attempt = view.findViewById<TextView>(R.id.tvCallbackAttempt)
            val call = view.findViewById<MaterialButton>(R.id.btnCallbackCall)

            name.text = task.displayName
            number.text = task.numberRaw.ifBlank { task.numberNormalized }

            val ageMs = System.currentTimeMillis() - task.firstMissAt
            val overdue = ageMs >= 2L * 60L * 60L * 1000L
            badge.text = if (overdue) "Overdue" else "Pending"
            badge.setBackgroundResource(if (overdue) R.drawable.bg_chip_overdue else R.drawable.bg_chip_pending)

            val sim = task.simSlotIndex?.let { "SIM ${it + 1}" }
            val repeats = if (task.missedCount > 1) "${task.missedCount} missed calls" else null
            meta.text = listOfNotNull(
                "Missed ${CallbackEngine.ageText(task.firstMissAt)} ago",
                repeats,
                sim
            ).joinToString("  •  ")

            if (task.latestAttemptAt != null) {
                attempt.visibility = View.VISIBLE
                attempt.text = "Tried ${SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(task.latestAttemptAt))}  •  No answer"
                call.text = "Call again"
            } else {
                attempt.visibility = View.GONE
                call.text = "Call back"
            }

            val dial = View.OnClickListener { dial(task) }
            call.setOnClickListener(dial)
            view.setOnClickListener { showCallbackDetail(task) }

            view.alpha = 0f
            view.translationY = 8f
            view.animate().alpha(1f).translationY(0f).setDuration(180L + index * 20L).start()
            b.callbackList.addView(view)
        }

        b.btnViewAllCallbacks.visibility = if (summary.pending.size > 5) View.VISIBLE else View.GONE
        b.btnViewAllCallbacks.text = if (showAllCallbacks) "Show fewer" else "View all ${summary.pending.size} callbacks"

        focusNumber?.let { key ->
            summary.pending.firstOrNull { it.key == key }?.let { showCallbackDetail(it) }
            focusNumber = null
        }
    }

    private fun showCallbackDetail(task: CallbackTask) {
        val view = LayoutInflater.from(this).inflate(R.layout.dialog_callback_detail, null, false)
        view.findViewById<TextView>(R.id.tvDetailName).text = task.displayName
        view.findViewById<TextView>(R.id.tvDetailNumber).text = task.numberRaw.ifBlank { task.numberNormalized }

        val overdue = System.currentTimeMillis() - task.firstMissAt >= 2L * 60L * 60L * 1000L
        val state = view.findViewById<TextView>(R.id.tvDetailState)
        state.text = if (overdue) "Callback overdue" else "Callback required"
        state.setBackgroundResource(if (overdue) R.drawable.bg_chip_overdue else R.drawable.bg_chip_pending)

        val timeline = buildString {
            append("MISSED CALL\n")
            append(SimpleDateFormat("dd MMM, h:mm a", Locale.getDefault()).format(Date(task.firstMissAt)))
            if (task.ringSeconds > 0) append("  •  Rang ${task.ringSeconds}s")
            task.simSlotIndex?.let { append("  •  SIM ${it + 1}") }
            if (task.missedCount > 1) {
                append("\n\nREPEATED CALLS\n")
                append("Customer called ${task.missedCount} times. Latest miss: ")
                append(SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(task.latestMissAt)))
            }
            task.latestAttemptAt?.let {
                append("\n\nCALLBACK ATTEMPT\n")
                append(SimpleDateFormat("dd MMM, h:mm a", Locale.getDefault()).format(Date(it)))
                append("\nNot connected — follow-up remains pending.")
            }
        }
        view.findViewById<TextView>(R.id.tvDetailTimeline).text = timeline
        view.findViewById<MaterialButton>(R.id.btnDetailCall).apply {
            text = if (task.latestAttemptAt != null) "Call again" else "Call back"
            setOnClickListener { dial(task) }
        }

        MaterialAlertDialogBuilder(this)
            .setView(view)
            .setNegativeButton("Close", null)
            .show()
    }

    private fun dial(task: CallbackTask) {
        val number = task.numberRaw.ifBlank { task.numberNormalized }
        startActivity(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null)))
    }

    private fun refreshAlertCard() {
        val enabled = FollowUpNotifier.notificationsAllowed(this)
        b.tvAlertStatus.text = if (enabled) {
            "Active. Fireblade will remind you when a missed customer call remains unresolved."
        } else {
            "Enable alerts so Fireblade can remind you when a missed customer call still needs a successful callback."
        }
        b.btnEnableAlerts.visibility = if (enabled) View.GONE else View.VISIBLE
    }

    private fun renderUpdateState() {
        b.tvAppVersion.text = "Current ${installedVersionText()}"
        val update = config.availableRelease
        if (update.isBlank()) {
            b.btnUpdate.visibility = View.GONE
            if (b.tvUpdateStatus.text == "Checking…") return
            if (b.tvUpdateStatus.text != "Check failed" && b.tvUpdateStatus.text != "Connection required") {
                b.tvUpdateStatus.text = "Up to date"
            }
            return
        }
        try {
            val release = JSONObject(update)
            b.tvUpdateStatus.text = if (AppUpdater.ready(this)) "Update ready" else "Update available"
            b.tvReleaseNotes.text = release.optString("notes").ifBlank {
                "Fireblade ${release.optString("version_name")} is available."
            }
            b.btnUpdate.visibility = View.VISIBLE
            b.btnUpdate.text = if (AppUpdater.ready(this)) "Install update" else "Download update"
        } catch (_: Exception) {
            b.btnUpdate.visibility = View.GONE
        }
    }

    @Suppress("DEPRECATION")
    private fun installedVersionText(): String {
        val info = packageManager.getPackageInfo(packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
        return "${info.versionName ?: "Unknown"} ($code)"
    }
}
