package com.nunes.callcollector

import android.app.DatePickerDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.nunes.callcollector.control.DeviceHttpError
import com.nunes.callcollector.control.EmployeeCall
import com.nunes.callcollector.control.EmployeeWorkspaceApi
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.data.CallEntity
import com.nunes.callcollector.databinding.ActivityHistoryBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class HistoryActivity : AppCompatActivity() {
    private lateinit var b: ActivityHistoryBinding
    private val config by lazy { ConfigStore(this) }
    private val dateStore by lazy { DateSelectionStore(this) }
    private var selectedDayStart = 0L
    private var refreshJob: Job? = null

    private enum class Source { SERVER, CACHE, LOCAL, BLOCKED }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityHistoryBinding.inflate(layoutInflater)
        setContentView(b.root)

        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(b.root) { view, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        selectedDayStart = dateStore.select(
            intent.getLongExtra("selected_day_start", dateStore.selectedDayStart())
        )
        PremiumNav.bind(this, b.root, PremiumTab.HISTORY)
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
                val local = AppDatabase.get(this@HistoryActivity).callDao().latest(10_000)
                    .filter {
                        it.startedAtEpochMs >= day &&
                            it.startedAtEpochMs < FirebladeDatePolicy.nextDayStart(day)
                    }
                    .sortedByDescending { it.startedAtEpochMs }
                    .map { it.toEmployeeCall() }

                if (config.deviceToken.isNotBlank() && config.apiUrl.startsWith("https://")) {
                    try {
                        val workspace = EmployeeWorkspaceApi.load(config, day)
                        if (workspace.historySupported) {
                            Triple(
                                workspace.calls,
                                Source.SERVER,
                                if (workspace.historyLimitReached) "Showing the newest 2,000 calls for this date." else ""
                            )
                        } else {
                            Triple(local, Source.LOCAL, "Server history upgrade is not active yet.")
                        }
                    } catch (e: DeviceHttpError) {
                        if (e.status in listOf(401, 403, 409)) {
                            Triple(emptyList(), Source.BLOCKED, e.message ?: "")
                        } else {
                            val cached = EmployeeWorkspaceApi.loadCached(config, day)
                            if (cached != null && cached.historySupported) Triple(cached.calls, Source.CACHE, e.message ?: "")
                            else Triple(local, Source.LOCAL, e.message ?: "")
                        }
                    } catch (e: Exception) {
                        val cached = EmployeeWorkspaceApi.loadCached(config, day)
                        if (cached != null && cached.historySupported) Triple(cached.calls, Source.CACHE, e.message ?: "")
                        else Triple(local, Source.LOCAL, e.message ?: "")
                    }
                } else {
                    Triple(local, Source.LOCAL, "")
                }
            }
            if (day == selectedDayStart) render(result.first, result.second, result.third)
        }
    }

    private fun render(calls: List<EmployeeCall>, source: Source, message: String) {
        b.btnDate.text = "${FirebladeDatePolicy.label(selectedDayStart)}  \u2022  ${FirebladeDatePolicy.displayDate(selectedDayStart)}"
        b.tvSourceStatus.text = when (source) {
            Source.SERVER -> if (message.isBlank()) "Employee-wide Fireblade call history" else message
            Source.CACHE -> "Last verified employee-wide call history"
            Source.BLOCKED -> message.ifBlank { "This phone needs Fireblade Admin attention." }
            Source.LOCAL -> "Local phone history - employee-wide server history is temporarily unavailable"
        }

        b.historyList.removeAllViews()
        b.emptyState.visibility = if (calls.isEmpty()) View.VISIBLE else View.GONE

        calls.forEach { call ->
            val view = LayoutInflater.from(this).inflate(R.layout.history_call_row, b.historyList, false)
            val name = call.contactName?.takeIf { it.isNotBlank() }
                ?: call.numberRaw.ifBlank { call.numberNormalized.ifBlank { "Unknown" } }

            view.findViewById<TextView>(R.id.tvHistoryName).text = name
            view.findViewById<TextView>(R.id.tvHistoryNumber).text =
                call.numberRaw.ifBlank { call.numberNormalized }
            view.findViewById<TextView>(R.id.tvHistoryTime).text =
                FirebladeDatePolicy.displayTime(call.startedAtEpochMs)

            val label = when (call.direction) {
                "INCOMING_ANSWERED" -> "Incoming"
                "INCOMING_MISSED" -> "Missed"
                "OUTGOING_CONNECTED" -> "Outgoing"
                "OUTGOING_UNANSWERED" -> "Outgoing - no answer"
                else -> call.direction.replace('_', ' ').lowercase().replaceFirstChar { it.titlecase() }
            }
            val sim = call.simSlotIndex?.let { "SIM ${it + 1}" }
            val device = call.deviceId.takeIf { it.isNotBlank() }
            val duration = if (call.durationSeconds > 0) formatDuration(call.durationSeconds) else null

            view.findViewById<TextView>(R.id.tvHistoryMeta).apply {
                text = listOfNotNull(label, sim, device, duration).joinToString("  \u2022  ")
                setTextColor(
                    when (call.direction) {
                        "INCOMING_MISSED" -> Color.parseColor("#B43A3A")
                        "INCOMING_ANSWERED" -> Color.parseColor("#16794B")
                        else -> Color.parseColor("#6B665E")
                    }
                )
            }

            view.findViewById<ImageView>(R.id.ivHistoryIcon).setColorFilter(
                when (call.direction) {
                    "INCOMING_MISSED" -> Color.parseColor("#B43A3A")
                    "INCOMING_ANSWERED" -> Color.parseColor("#16794B")
                    else -> Color.parseColor("#5B5750")
                }
            )

            view.setOnClickListener {
                val number = call.numberRaw.ifBlank { call.numberNormalized }
                if (number.isNotBlank()) {
                    startActivity(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null)))
                }
            }
            b.historyList.addView(view)
        }
    }

    private fun formatDuration(seconds: Long): String {
        val m = seconds / 60
        val s = seconds % 60
        return if (m > 0) "${m}m ${s}s" else "${s}s"
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

    private fun CallEntity.toEmployeeCall() = EmployeeCall(
        callId = localId,
        deviceId = config.deviceId,
        numberRaw = numberRaw,
        numberNormalized = numberNormalized,
        contactName = contactName,
        direction = direction,
        startedAtEpochMs = startedAtEpochMs,
        durationSeconds = durationSeconds,
        lineId = null,
        companyPhoneNumber = null,
        lineLabel = null,
        carrierName = null,
        simSlotIndex = simSlotIndex
    )
}
