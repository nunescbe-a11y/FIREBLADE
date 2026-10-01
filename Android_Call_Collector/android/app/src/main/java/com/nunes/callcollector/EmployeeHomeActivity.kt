package com.nunes.callcollector

import android.app.DatePickerDialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.nunes.callcollector.callbacks.CallbackEngine
import com.nunes.callcollector.callbacks.CallbackRefreshWorker
import com.nunes.callcollector.callbacks.CallbackSummary
import com.nunes.callcollector.control.AppUpdater
import com.nunes.callcollector.control.CommandWorker
import com.nunes.callcollector.control.DeviceHttpError
import com.nunes.callcollector.control.EmployeeLine
import com.nunes.callcollector.control.EmployeeWorkspace
import com.nunes.callcollector.control.EmployeeWorkspaceApi
import com.nunes.callcollector.control.UpdateWorker
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.databinding.ActivityEmployeeHomeBinding
import com.nunes.callcollector.health.HealthReporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class EmployeeHomeActivity : AppCompatActivity() {
    private lateinit var b: ActivityEmployeeHomeBinding
    private val config by lazy { ConfigStore(this) }
    private val dateStore by lazy { DateSelectionStore(this) }
    private var selectedDayStart = 0L
    private var profileBitmap: Bitmap? = null
    private var profileKey: String? = null
    private var refreshJob: Job? = null
    private var mandatoryUpdateDialogShown = false

    private enum class Source { SERVER, CACHE, LOCAL, BLOCKED }

    private data class HomeData(
        val snapshot: JSONObject,
        val summary: CallbackSummary,
        val workspace: EmployeeWorkspace?,
        val uploadPending: Int,
        val source: Source,
        val message: String?
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityEmployeeHomeBinding.inflate(layoutInflater)
        setContentView(b.root)

        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(b.root) { view, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        selectedDayStart = intent.getLongExtra(
            "selected_day_start",
            dateStore.selectedDayStart()
        )
        selectedDayStart = dateStore.select(selectedDayStart)

        PremiumNav.bind(this, b.root, PremiumTab.HOME)
        b.btnDate.setOnClickListener { openDatePicker() }
        b.pendingHero.setOnClickListener {
            startActivity(
                Intent(this, CallbacksActivity::class.java)
                    .putExtra("selected_day_start", selectedDayStart)
            )
        }

        AutomationScheduler.schedulePeriodicReconciliation(this)
        AutomationScheduler.enqueueCapture(this, 1)
        AutomationScheduler.enqueueHealth(this, "APP_OPEN", 1)
        AutomationScheduler.scheduleNextHealthPulse(this)
        CommandWorker.enqueue(this)
        UpdateWorker.schedule(this)
        UpdateWorker.now(this)
        CallbackRefreshWorker.schedule(this)
        CallbackRefreshWorker.enqueue(this)

        Handler(Looper.getMainLooper()).postDelayed({
            b.splashOverlay.animate()
                .alpha(0f)
                .setDuration(220L)
                .withEndAction { b.splashOverlay.visibility = View.GONE }
                .start()
        }, 420L)
    }

    override fun onResume() {
        super.onResume()
        selectedDayStart = dateStore.selectedDayStart()
        refresh()
        maybeShowMandatoryUpdate()
    }

    override fun onDestroy() {
        refreshJob?.cancel()
        super.onDestroy()
    }

    private fun refresh() {
        val day = selectedDayStart
        refreshJob?.cancel()
        refreshJob = lifecycleScope.launch {
            val data = withContext(Dispatchers.IO) {
                val dao = AppDatabase.get(this@EmployeeHomeActivity).callDao()
                val local = CallbackEngine.computeForDay(
                    calls = dao.latest(10_000),
                    selectedDayStart = day
                )
                val pendingUpload = dao.pendingCount()

                var workspace: EmployeeWorkspace? = null
                var source = Source.LOCAL
                var message: String? = null

                if (
                    config.deviceToken.isNotBlank() &&
                    config.deviceId.isNotBlank() &&
                    config.apiUrl.startsWith("https://")
                ) {
                    try {
                        workspace = EmployeeWorkspaceApi.load(config, day)
                        source = Source.SERVER
                    } catch (e: DeviceHttpError) {
                        if (e.status in listOf(401, 403, 409)) {
                            source = Source.BLOCKED
                            message = e.message
                        } else {
                            workspace = EmployeeWorkspaceApi.loadCached(config, day)
                            source = if (workspace != null) Source.CACHE else Source.LOCAL
                            message = e.message
                        }
                    } catch (e: Exception) {
                        workspace = EmployeeWorkspaceApi.loadCached(config, day)
                        source = if (workspace != null) Source.CACHE else Source.LOCAL
                        message = e.message ?: e.javaClass.simpleName
                    }
                }

                val snapshot = HealthReporter.collect(this@EmployeeHomeActivity, "UI", config)
                HomeData(
                    snapshot = snapshot,
                    summary = workspace?.summary ?: local,
                    workspace = workspace,
                    uploadPending = pendingUpload,
                    source = source,
                    message = message
                )
            }
            if (day == selectedDayStart) render(data)
        }
    }

    private fun render(data: HomeData) {
        val workspace = data.workspace
        val employee = workspace?.employeeName?.takeIf { it.isNotBlank() }
            ?: config.employee.takeIf { it.isNotBlank() }
            ?: "Fireblade employee"

        b.tvEmployeeName.text = "${FirebladeDatePolicy.greeting()}, ${prettyName(employee)}"
        b.tvEmployeeMeta.text = if (workspace != null) {
            buildList {
                workspace.departmentName?.takeIf { it.isNotBlank() }?.let { add(it) }
                workspace.employeeId.takeIf { it.isNotBlank() }?.let { add(it) }
                workspace.currentDeviceId.takeIf { it.isNotBlank() }?.let { add(it) }
            }.joinToString("  \u2022  ").ifBlank { "Employee workspace" }
        } else {
            listOfNotNull(
                config.employee.takeIf { it.isNotBlank() },
                config.deviceId.takeIf { it.isNotBlank() }
            ).joinToString("  \u2022  ").ifBlank { "Setup required" }
        }

        val summary = data.summary
        b.tvPendingCount.text = summary.pendingCount.toString()
        b.tvTotalIncoming.text = summary.totalIncomingCount.toString()
        b.tvAnswered.text = summary.answeredCount.toString()
        b.tvMissed.text = summary.missedCount.toString()
        b.tvResolved.text = summary.resolvedToday.toString()
        b.btnDate.text = "${FirebladeDatePolicy.label(selectedDayStart)}  \u2022  ${FirebladeDatePolicy.displayDate(selectedDayStart)}"

        when (data.source) {
            Source.SERVER -> {
                b.tvSyncBadge.text = "Synced"
                b.tvSyncBadge.setTextColor(Color.parseColor("#16794B"))
                b.tvSyncBadge.setBackgroundResource(R.drawable.bg_premium_success_soft)
                b.tvSyncStatus.text = "Fireblade Web and this phone are synchronized."
            }
            Source.CACHE -> {
                b.tvSyncBadge.text = "Cached"
                b.tvSyncBadge.setTextColor(Color.parseColor("#8A5A00"))
                b.tvSyncBadge.setBackgroundResource(R.drawable.bg_premium_chip)
                b.tvSyncStatus.text = "Server is temporarily unavailable. Showing the last verified employee-wide snapshot."
            }
            Source.BLOCKED -> {
                b.tvSyncBadge.text = "Admin action"
                b.tvSyncBadge.setTextColor(Color.parseColor("#B43A3A"))
                b.tvSyncBadge.setBackgroundResource(R.drawable.bg_premium_danger_soft)
                b.tvSyncStatus.text = data.message?.takeIf { it.isNotBlank() }
                    ?: "This phone is no longer assigned or authorized. Contact Fireblade Admin."
            }
            Source.LOCAL -> {
                val internet = data.snapshot.optBoolean("internet_available")
                b.tvSyncBadge.text = if (internet) "Local" else "Offline"
                b.tvSyncBadge.setTextColor(Color.parseColor(if (internet) "#6B665E" else "#B43A3A"))
                b.tvSyncBadge.setBackgroundResource(
                    if (internet) R.drawable.bg_premium_chip else R.drawable.bg_premium_danger_soft
                )
                b.tvSyncStatus.text = if (internet) {
                    data.message?.let { "Employee-wide data unavailable. This phone's local data is shown." }
                        ?: "This phone's local data is shown until Fireblade synchronization completes."
                } else {
                    "Offline. Saved call data remains available and will synchronize automatically."
                }
            }
        }

        if (data.uploadPending > 0 && data.source != Source.BLOCKED) {
            b.tvSyncStatus.text = "${b.tvSyncStatus.text}  ${data.uploadPending} call${if (data.uploadPending == 1) "" else "s"} waiting to upload."
        }

        val currentLines = workspace?.lines
            ?.filter { it.deviceId.equals(workspace.currentDeviceId, ignoreCase = true) }
            ?.sortedBy { it.simSlotIndex ?: Int.MAX_VALUE }
            .orEmpty()

        bindLine(0, currentLines.getOrNull(0))
        bindLine(1, currentLines.getOrNull(1))
        b.simCard2.visibility = if (currentLines.getOrNull(1) == null) View.GONE else View.VISIBLE

        renderAvatar(employee, workspace)
    }

    private fun renderAvatar(employee: String, workspace: EmployeeWorkspace?) {
        val initials = employee.split(Regex("\\s+"))
            .filter { it.isNotBlank() }
            .take(2)
            .mapNotNull { it.firstOrNull()?.uppercaseChar() }
            .joinToString("")
            .ifBlank { "FB" }
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

        b.ivPhoto.visibility = View.GONE
        b.tvInitials.visibility = View.VISIBLE
        profileKey = key
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

    private fun bindLine(index: Int, line: EmployeeLine?) {
        val title = if (index == 0) b.tvSim1Title else b.tvSim2Title
        val number = if (index == 0) b.tvSim1Number else b.tvSim2Number
        val carrier = if (index == 0) b.tvSim1Carrier else b.tvSim2Carrier
        title.text = line?.lineLabel?.takeIf { it.isNotBlank() } ?: "SIM ${index + 1}"
        number.text = line?.phoneNumber?.takeIf { it.isNotBlank() } ?: "No active company SIM"
        carrier.text = listOfNotNull(
            line?.carrierName?.takeIf { it.isNotBlank() },
            line?.deviceId?.takeIf { it.isNotBlank() }
        ).joinToString("  \u2022  ")
    }

    private fun openDatePicker() {
        val date = java.time.Instant.ofEpochMilli(selectedDayStart)
            .atZone(FirebladeDatePolicy.zone).toLocalDate()
        DatePickerDialog(
            this,
            { _, year, month, day ->
                val chosen = FirebladeDatePolicy.fromPicker(year, month, day)
                selectedDayStart = dateStore.select(chosen)
                refresh()
            },
            date.year,
            date.monthValue - 1,
            date.dayOfMonth
        ).apply {
            datePicker.maxDate = System.currentTimeMillis()
            show()
        }
    }

    private fun maybeShowMandatoryUpdate() {
        if (mandatoryUpdateDialogShown || config.availableRelease.isBlank()) return
        mandatoryUpdateDialogShown = true
        val ready = AppUpdater.ready(this)
        MaterialAlertDialogBuilder(this)
            .setTitle("Fireblade update required")
            .setMessage(
                if (ready) "A verified Fireblade update is ready. Install it now to keep employee data and callback rules consistent."
                else "A Fireblade update is being prepared. Keep this phone online; installation will be available shortly."
            )
            .setPositiveButton(if (ready) "Install update" else "OK") { _, _ ->
                if (ready) AppUpdater.install(this)
                mandatoryUpdateDialogShown = false
            }
            .setCancelable(!ready)
            .show()
    }

    private fun prettyName(value: String): String =
        value.lowercase().split(Regex("\\s+")).joinToString(" ") { part ->
            part.replaceFirstChar { it.titlecase() }
        }
}
