package com.nunes.callcollector

import android.app.DatePickerDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.nunes.callcollector.control.DeviceHttpError
import com.nunes.callcollector.control.EmployeeCall
import com.nunes.callcollector.control.EmployeeWorkspaceApi
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.data.CallEntity
import com.nunes.callcollector.data.ShaneCallDetailEntity
import com.nunes.callcollector.databinding.ActivityHistoryBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs

class HistoryActivity : AppCompatActivity() {
    private lateinit var b: ActivityHistoryBinding
    private val config by lazy { ConfigStore(this) }
    private val dateStore by lazy { DateSelectionStore(this) }
    private var selectedDayStart = 0L
    private var refreshJob: Job? = null
    private var liveReceiverRegistered = false
    private val liveCallReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == LiveCallStore.ACTION_CHANGED && ShaneMode.isEnabled(this@HistoryActivity)) {
                refreshShaneLocalFirst()
            }
        }
    }

    private enum class Source { SERVER, CACHE, LOCAL, BLOCKED }
    private enum class SimFilter(val label: String) {
        ALL("All SIMs"),
        SIM_1("SIM 1"),
        SIM_2("SIM 2")
    }
    private var selectedSimFilter: SimFilter = SimFilter.ALL

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

        setupSimFilterSpinner()
    }

    private fun setupSimFilterSpinner() {
        val options = SimFilter.values().map { it.label }
        val adapter = android.widget.ArrayAdapter(
            this,
            android.R.layout.simple_spinner_item,
            options
        ).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
        b.spinnerSimFilter.adapter = adapter
        b.spinnerSimFilter.setSelection(selectedSimFilter.ordinal)
        b.spinnerSimFilter.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(
                parent: android.widget.AdapterView<*>?,
                view: View?,
                position: Int,
                id: Long
            ) {
                val newFilter = SimFilter.values().getOrElse(position) { SimFilter.ALL }
                if (newFilter != selectedSimFilter) {
                    selectedSimFilter = newFilter
                    refresh()
                }
            }

            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
        }
    }

    override fun onStart() {
        super.onStart()
        if (!liveReceiverRegistered) {
            ContextCompat.registerReceiver(
                this,
                liveCallReceiver,
                IntentFilter(LiveCallStore.ACTION_CHANGED),
                ContextCompat.RECEIVER_NOT_EXPORTED
            )
            liveReceiverRegistered = true
        }
    }

    override fun onResume() {
        super.onResume()
        selectedDayStart = dateStore.selectedDayStart()
        refresh()
    }

    override fun onStop() {
        if (liveReceiverRegistered) {
            unregisterReceiver(liveCallReceiver)
            liveReceiverRegistered = false
        }
        super.onStop()
    }

    override fun onDestroy() {
        refreshJob?.cancel()
        super.onDestroy()
    }

    private fun refresh() {
        if (ShaneMode.isEnabled(this)) {
            refreshShaneLocalFirst()
            return
        }

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

    private fun refreshShaneLocalFirst() {
        val day = selectedDayStart
        refreshJob?.cancel()
        refreshJob = lifecycleScope.launch {
            val data = withContext(Dispatchers.IO) {
                val db = AppDatabase.get(this@HistoryActivity)
                val calls = db.callDao().latest(10_000)
                    .filter {
                        it.startedAtEpochMs >= day &&
                            it.startedAtEpochMs < FirebladeDatePolicy.nextDayStart(day)
                    }
                    .sortedByDescending { it.startedAtEpochMs }
                val details = db.shaneCallDetailDao().latestAll(10_000)
                calls to details
            }
            if (day == selectedDayStart) renderShane(data.first, data.second)
        }
    }

    private fun renderShane(
        localCalls: List<CallEntity>,
        details: List<ShaneCallDetailEntity>
    ) {
        b.btnDate.text =
            FirebladeDatePolicy.label(selectedDayStart) + "  •  " +
                FirebladeDatePolicy.displayDate(selectedDayStart)
        b.tvSourceStatus.text =
            "Live local call history • background cloud sync stays out of the UI path"

        val filteredLocalCalls = when (selectedSimFilter) {
            SimFilter.ALL -> localCalls
            SimFilter.SIM_1 -> localCalls.filter { it.simSlotIndex == 0 }
            SimFilter.SIM_2 -> localCalls.filter { it.simSlotIndex == 1 }
        }

        val calls = filteredLocalCalls.toMutableList()
        val live = LiveCallStore.snapshot(this)
        if (
            live != null &&
            live.startedAtEpochMs >= selectedDayStart &&
            live.startedAtEpochMs < FirebladeDatePolicy.nextDayStart(selectedDayStart)
        ) {
            val matchesSimFilter = selectedSimFilter == SimFilter.ALL
            if (matchesSimFilter) {
                val normalized = PhoneNumberUtil.normalizeIndia(live.phoneNumber)
                val alreadyPresent = calls.any {
                    abs(it.startedAtEpochMs - live.startedAtEpochMs) <= 90_000L &&
                        (
                            normalized.isBlank() ||
                                it.numberNormalized == normalized ||
                                it.numberRaw == live.phoneNumber
                        )
                }
                if (!alreadyPresent) {
                    calls += CallEntity(
                        sourceCallId = "LIVE:" + live.sessionId,
                        numberRaw = live.phoneNumber,
                        numberNormalized = normalized,
                        contactName = null,
                        direction = when {
                            live.direction == "INCOMING" && live.state == "RINGING" -> "INCOMING_RINGING"
                            live.direction == "INCOMING" && live.hadConversation -> "INCOMING_ANSWERED"
                            live.direction == "INCOMING" -> "INCOMING_MISSED"
                            live.direction == "OUTGOING" && live.hadConversation -> "OUTGOING_CONNECTED"
                            else -> "OUTGOING_ACTIVE"
                        },
                        startedAtEpochMs = live.startedAtEpochMs,
                        durationSeconds = live.durationSeconds,
                        simSlotIndex = null
                    )
                }
            }
        }

        val sorted = calls.sortedByDescending { it.startedAtEpochMs }
        b.historyList.removeAllViews()
        b.emptyState.visibility = if (sorted.isEmpty()) View.VISIBLE else View.GONE

        sorted.forEach { call ->
            val detail = details.firstOrNull { row ->
                row.sourceCallId == call.sourceCallId ||
                    (
                        row.phoneNumberNormalized.isNotBlank() &&
                            row.phoneNumberNormalized == call.numberNormalized &&
                            abs(row.callStartedAtEpochMs - call.startedAtEpochMs) <= 90_000L
                        )
            }

            val view = LayoutInflater.from(this).inflate(R.layout.history_call_row, b.historyList, false)
            val displayName = detail?.customerName?.takeIf { it.isNotBlank() }
                ?: call.contactName?.takeIf { it.isNotBlank() }
                ?: call.numberRaw.ifBlank { call.numberNormalized.ifBlank { "Unknown" } }

            view.findViewById<TextView>(R.id.tvHistoryName).text = displayName
            view.findViewById<TextView>(R.id.tvHistoryNumber).text =
                call.numberRaw.ifBlank { call.numberNormalized }
            view.findViewById<TextView>(R.id.tvHistoryTime).text =
                FirebladeDatePolicy.displayTime(call.startedAtEpochMs)

            val liveRow = call.sourceCallId.startsWith("LIVE:")
            val label = when (call.direction) {
                "INCOMING_RINGING" -> "Incoming • ringing"
                "INCOMING_ANSWERED" -> if (liveRow && live?.state == "CONNECTED") "Incoming • on call" else "Incoming"
                "INCOMING_MISSED" -> "Missed"
                "INCOMING_REJECTED" -> "Rejected"
                "OUTGOING_CONNECTED" -> if (liveRow && live?.state == "CONNECTED") "Outgoing • on call" else "Outgoing"
                "OUTGOING_UNANSWERED" -> "Outgoing • no answer"
                "OUTGOING_ACTIVE" -> "Outgoing • in progress"
                else -> call.direction.replace('_', ' ').lowercase().replaceFirstChar { it.titlecase() }
            }
            val sim = call.simSlotIndex?.let { "SIM " + (it + 1) }
            val duration = if (call.durationSeconds > 0) formatDuration(call.durationSeconds) else null

            view.findViewById<TextView>(R.id.tvHistoryMeta).apply {
                text = listOfNotNull(label, sim, duration).joinToString("  •  ")
                setTextColor(
                    when (call.direction) {
                        "INCOMING_MISSED", "INCOMING_REJECTED" -> Color.parseColor("#B43A3A")
                        "INCOMING_ANSWERED" -> Color.parseColor("#16794B")
                        else -> Color.parseColor("#6B665E")
                    }
                )
            }

            view.findViewById<ImageView>(R.id.ivHistoryIcon).setColorFilter(
                when (call.direction) {
                    "INCOMING_MISSED", "INCOMING_REJECTED" -> Color.parseColor("#B43A3A")
                    "INCOMING_ANSWERED" -> Color.parseColor("#16794B")
                    else -> Color.parseColor("#5B5750")
                }
            )

            view.findViewById<TextView>(R.id.tvHistoryDetail).apply {
                val detailText = listOfNotNull(
                    detail?.productAsked?.takeIf { it.isNotBlank() },
                    detail?.location?.takeIf { it.isNotBlank() }
                ).joinToString("  •  ")
                text = detailText
                visibility = if (detailText.isBlank()) View.GONE else View.VISIBLE
            }

            view.findViewById<TextView>(R.id.tvHistoryUrgent).visibility =
                if (detail?.veryUrgent == true) View.VISIBLE else View.GONE

            view.setOnClickListener {
                val source = call.sourceCallId.takeUnless { it.startsWith("LIVE:") }
                startActivity(
                    Intent(this, ShaneCallDetailActivity::class.java)
                        .putExtra(ShaneCallDetailActivity.EXTRA_SOURCE_CALL_ID, source)
                        .putExtra(ShaneCallDetailActivity.EXTRA_PHONE_RAW, call.numberRaw)
                        .putExtra(ShaneCallDetailActivity.EXTRA_PHONE_NORMALIZED, call.numberNormalized)
                        .putExtra(ShaneCallDetailActivity.EXTRA_STARTED_AT, call.startedAtEpochMs)
                )
            }
            b.historyList.addView(view)
        }
    }

    private fun render(calls: List<EmployeeCall>, source: Source, message: String) {
        b.btnDate.text =
            FirebladeDatePolicy.label(selectedDayStart) + "  •  " +
                FirebladeDatePolicy.displayDate(selectedDayStart)
        b.tvSourceStatus.text = when (source) {
            Source.SERVER -> if (message.isBlank()) "Employee-wide Fireblade call history" else message
            Source.CACHE -> "Last verified employee-wide call history"
            Source.BLOCKED -> message.ifBlank { "This phone needs Fireblade Admin attention." }
            Source.LOCAL -> "Local phone history - employee-wide server history is temporarily unavailable"
        }

        val filteredCalls = when (selectedSimFilter) {
            SimFilter.ALL -> calls
            SimFilter.SIM_1 -> calls.filter { it.simSlotIndex == 0 }
            SimFilter.SIM_2 -> calls.filter { it.simSlotIndex == 1 }
        }

        b.historyList.removeAllViews()
        b.emptyState.visibility = if (filteredCalls.isEmpty()) View.VISIBLE else View.GONE

        filteredCalls.forEach { call ->
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
            val sim = call.simSlotIndex?.let { "SIM " + (it + 1) }
            val device = call.deviceId.takeIf { it.isNotBlank() }
            val duration = if (call.durationSeconds > 0) formatDuration(call.durationSeconds) else null

            view.findViewById<TextView>(R.id.tvHistoryMeta).apply {
                text = listOfNotNull(label, sim, device, duration).joinToString("  •  ")
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

            view.findViewById<TextView>(R.id.tvHistoryDetail).visibility = View.GONE
            view.findViewById<TextView>(R.id.tvHistoryUrgent).visibility = View.GONE

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
        return if (m > 0) m.toString() + "m " + s + "s" else s.toString() + "s"
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
