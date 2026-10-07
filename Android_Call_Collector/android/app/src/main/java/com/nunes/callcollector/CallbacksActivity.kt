package com.nunes.callcollector

import android.app.DatePickerDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.nunes.callcollector.callbacks.CallbackEngine
import com.nunes.callcollector.callbacks.CallbackSummary
import com.nunes.callcollector.callbacks.CallbackTask
import com.nunes.callcollector.control.DeviceHttpError
import com.nunes.callcollector.control.EmployeeWorkspaceApi
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.databinding.ActivityCallbacksBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class CallbacksActivity : AppCompatActivity() {
    private lateinit var b: ActivityCallbacksBinding
    private val config by lazy { ConfigStore(this) }
    private val dateStore by lazy { DateSelectionStore(this) }
    private var selectedDayStart = 0L
    private var refreshJob: Job? = null
    private var focusNumber: String? = null

    private enum class Source { SERVER, CACHE, LOCAL, BLOCKED }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityCallbacksBinding.inflate(layoutInflater)
        setContentView(b.root)

        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(b.root) { view, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        selectedDayStart = dateStore.select(
            intent.getLongExtra("selected_day_start", dateStore.selectedDayStart())
        )
        focusNumber = intent.getStringExtra("focus_number")

        PremiumNav.bind(this, b.root, PremiumTab.CALLBACKS)
        b.btnBack.setOnClickListener { finish() }
        b.btnDate.setOnClickListener { openDatePicker() }
    }

    override fun onResume() {
        super.onResume()
        selectedDayStart = dateStore.selectedDayStart()
        refresh()
    }

    override fun onDestroy() {
        refreshJob?.cancel()
        super.onDestroy()
    }

    private fun refresh() {
        val day = selectedDayStart
        refreshJob?.cancel()
        refreshJob = lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                val dao = AppDatabase.get(this@CallbacksActivity).callDao()
                val dayStart = FirebladeDatePolicy.startOfDay(day)
                val dayEnd = System.currentTimeMillis().coerceAtLeast(FirebladeDatePolicy.nextDayStart(dayStart))
                val local = CallbackEngine.computeForDay(dao.forDateRange(dayStart, dayEnd), day)
                if (config.deviceToken.isNotBlank() && config.apiUrl.startsWith("https://")) {
                    try {
                        Triple(EmployeeWorkspaceApi.load(config, day).summary, Source.SERVER, "")
                    } catch (e: DeviceHttpError) {
                        if (e.status in listOf(401, 403, 409)) {
                            Triple(CallbackSummary(emptyList(), 0, selectedDayStart = day), Source.BLOCKED, e.message ?: "")
                        } else {
                            val cached = EmployeeWorkspaceApi.loadCached(config, day)
                            if (cached != null) Triple(cached.summary, Source.CACHE, e.message ?: "")
                            else Triple(local, Source.LOCAL, e.message ?: "")
                        }
                    } catch (e: Exception) {
                        val cached = EmployeeWorkspaceApi.loadCached(config, day)
                        if (cached != null) Triple(cached.summary, Source.CACHE, e.message ?: "")
                        else Triple(local, Source.LOCAL, e.message ?: "")
                    }
                } else {
                    Triple(local, Source.LOCAL, "")
                }
            }
            if (day == selectedDayStart) render(result.first, result.second, result.third)
        }
    }

    private fun render(summary: CallbackSummary, source: Source, message: String) {
        b.btnDate.text = "${FirebladeDatePolicy.label(selectedDayStart)}  \u2022  ${FirebladeDatePolicy.displayDate(selectedDayStart)}"
        b.tvSummary.text = if (summary.pendingCount == 0) {
            "No unresolved callbacks for ${FirebladeDatePolicy.label(selectedDayStart).lowercase()}."
        } else {
            "${summary.pendingCount} customer${if (summary.pendingCount == 1) "" else "s"} waiting."
        }
        b.tvSourceStatus.text = when (source) {
            Source.SERVER -> "Employee-wide Fireblade data"
            Source.CACHE -> "Last verified employee-wide snapshot"
            Source.BLOCKED -> message.ifBlank { "This phone needs Fireblade Admin attention." }
            Source.LOCAL -> "Local phone fallback - server data is temporarily unavailable"
        }

        b.callbackList.removeAllViews()
        b.emptyState.visibility = if (summary.pending.isEmpty()) View.VISIBLE else View.GONE

        summary.pending.forEach { task ->
            val view = LayoutInflater.from(this).inflate(R.layout.callback_task_card, b.callbackList, false)
            view.findViewById<TextView>(R.id.tvCallbackName).text = task.displayName
            view.findViewById<TextView>(R.id.tvCallbackNumber).text =
                task.numberRaw.ifBlank { task.numberNormalized }
            view.findViewById<TextView>(R.id.tvCallbackBadge).text =
                if (System.currentTimeMillis() - task.firstMissAt >= 2L * 60L * 60L * 1000L) "Overdue" else "Pending"

            val sim = task.simSlotIndex?.let { "SIM ${it + 1}" }
            val repeats = if (task.missedCount > 1) "${task.missedCount} missed calls" else null
            view.findViewById<TextView>(R.id.tvCallbackMeta).text = listOfNotNull(
                "Missed ${CallbackEngine.ageText(task.firstMissAt)} ago",
                repeats,
                sim
            ).joinToString("  \u2022  ")

            val attempt = view.findViewById<TextView>(R.id.tvCallbackAttempt)
            if (task.latestAttemptAt != null) {
                attempt.visibility = View.VISIBLE
                attempt.text = "Previous callback attempt did not connect."
            } else {
                attempt.visibility = View.GONE
            }

            view.findViewById<MaterialButton>(R.id.btnCallbackCall).apply {
                text = if (task.latestAttemptAt != null) "Call again" else "Call back"
                setOnClickListener { dial(task) }
            }
            view.setOnClickListener { showDetail(task) }
            b.callbackList.addView(view)
        }

        focusNumber?.let { key ->
            summary.pending.firstOrNull {
                it.key == key || it.numberNormalized == key || it.numberRaw == key
            }?.let { showDetail(it) }
            focusNumber = null
        }
    }

    private fun showDetail(task: CallbackTask) {
        val view = LayoutInflater.from(this).inflate(R.layout.dialog_callback_detail, null, false)
        view.findViewById<TextView>(R.id.tvDetailName).text = task.displayName
        view.findViewById<TextView>(R.id.tvDetailNumber).text =
            task.numberRaw.ifBlank { task.numberNormalized }

        val overdue = System.currentTimeMillis() - task.firstMissAt >= 2L * 60L * 60L * 1000L
        view.findViewById<TextView>(R.id.tvDetailState).apply {
            text = if (overdue) "Callback overdue" else "Callback required"
            setBackgroundResource(if (overdue) R.drawable.bg_chip_overdue else R.drawable.bg_chip_pending)
        }

        view.findViewById<TextView>(R.id.tvDetailTimeline).text = buildString {
            append("Missed call\n")
            append(FirebladeDatePolicy.displayDateTime(task.firstMissAt))
            if (task.missedCount > 1) {
                append("\n\nRepeated calls\n")
                append("Customer called ${task.missedCount} times. Latest: ${FirebladeDatePolicy.displayTime(task.latestMissAt)}")
            }
            task.latestAttemptAt?.let {
                append("\n\nCallback attempt\n")
                append("${FirebladeDatePolicy.displayDateTime(it)} - not connected")
            }
        }

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
        if (number.isNotBlank()) {
            startActivity(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null)))
        }
    }

    private fun openDatePicker() {
        val date = java.time.Instant.ofEpochMilli(selectedDayStart)
            .atZone(FirebladeDatePolicy.zone).toLocalDate()
        DatePickerDialog(
            this,
            { _, year, month, day ->
                selectedDayStart = dateStore.select(FirebladeDatePolicy.fromPicker(year, month, day))
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
}
