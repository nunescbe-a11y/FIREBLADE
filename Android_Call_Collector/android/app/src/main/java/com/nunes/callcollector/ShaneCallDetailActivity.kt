package com.nunes.callcollector

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.CheckBox
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.nunes.callcollector.control.MarketingRecipient
import com.nunes.callcollector.control.ShaneMarketingApi
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.data.CallEntity
import com.nunes.callcollector.data.ShaneCallDetailEntity
import com.nunes.callcollector.databinding.ActivityShaneCallDetailBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

class ShaneCallDetailActivity : AppCompatActivity() {
    private lateinit var b: ActivityShaneCallDetailBinding
    private val db by lazy { AppDatabase.get(this) }
    private val config by lazy { ConfigStore(this) }

    private data class CallTarget(
        val sourceCallId: String?,
        val phoneRaw: String,
        val phoneNormalized: String,
        val startedAtEpochMs: Long
    )

    private var target: CallTarget? = null
    private var existing: ShaneCallDetailEntity? = null

    private var marketingRecipients: List<MarketingRecipient> = emptyList()
    private val selectedMarketingEmployeeIds = linkedSetOf<String>()

    private var queuedRecipients: List<MarketingRecipient> = emptyList()
    private var queuedMessage: String = ""
    private var queuedWhatsAppPackage: String? = null
    private var nextQueuedRecipientIndex: Int = 0
    private var waitingForWhatsAppReturn: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityShaneCallDetailBinding.inflate(layoutInflater)
        setContentView(b.root)

        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(b.root) { view, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        b.btnBack.setOnClickListener { finish() }
        b.btnSaveSend.setOnClickListener { saveAndSend() }
        b.cbVeryUrgent.setOnCheckedChangeListener { _, checked ->
            updatePriorityUi(checked)
        }
        updatePriorityUi(false)

        val immediateNumber = intent.getStringExtra(EXTRA_PHONE_RAW).orEmpty()
            .ifBlank { intent.getStringExtra(EXTRA_PHONE_NORMALIZED).orEmpty() }
        b.tvPhone.text = immediateNumber.ifBlank { "Preparing latest customer..." }

        loadMarketingRecipients()

        lifecycleScope.launch {
            val resolved = withContext(Dispatchers.IO) { resolveTarget() }
            if (resolved == null) {
                b.tvPhone.text = if (immediateNumber.isNotBlank()) immediateNumber else "No call selected"
                Toast.makeText(
                    this@ShaneCallDetailActivity,
                    "No completed spoken call is available yet.",
                    Toast.LENGTH_SHORT
                ).show()
                return@launch
            }
            target = resolved
            b.tvPhone.text = resolved.phoneRaw.ifBlank { resolved.phoneNormalized }

            val loaded = withContext(Dispatchers.IO) {
                val detailDao = db.shaneCallDetailDao()
                val current = resolved.sourceCallId?.takeIf { it.isNotBlank() }
                    ?.let { detailDao.bySourceCallId(it) }
                    ?: detailDao.nearestForCall(
                        resolved.phoneNormalized,
                        resolved.startedAtEpochMs - 90_000L,
                        resolved.startedAtEpochMs + 90_000L,
                        resolved.startedAtEpochMs
                    )
                val profile = if (current == null && resolved.phoneNormalized.isNotBlank()) {
                    detailDao.latestProfile(resolved.phoneNormalized)
                } else null
                current to profile
            }

            existing = loaded.first
            val current = loaded.first
            val profile = loaded.second
            b.etCustomerName.setText(current?.customerName ?: profile?.customerName.orEmpty())
            b.etProductAsked.setText(current?.productAsked.orEmpty())
            b.etLocation.setText(current?.location ?: profile?.location.orEmpty())
            b.etNotes.setText(current?.notes.orEmpty())
            b.cbVeryUrgent.isChecked = current?.veryUrgent == true
        }
    }

    override fun onResume() {
        super.onResume()
        if (waitingForWhatsAppReturn) {
            waitingForWhatsAppReturn = false
            handleWhatsAppReturn()
        }
    }

    private fun loadMarketingRecipients() {
        lifecycleScope.launch {
            try {
                val recipients = withContext(Dispatchers.IO) {
                    ShaneMarketingApi.load(config)
                }
                marketingRecipients = recipients
                renderMarketingRecipients()
            } catch (_: Exception) {
                marketingRecipients = emptyList()
                selectedMarketingEmployeeIds.clear()
                b.marketingEmployeeList.removeAllViews()
                b.tvMarketingStatus.text =
                    "Marketing employee list is temporarily unavailable. You can still save and open WhatsApp manually."
                updateMarketingSelectionUi()
            }
        }
    }

    private fun renderMarketingRecipients() {
        b.marketingEmployeeList.removeAllViews()

        if (marketingRecipients.isEmpty()) {
            b.tvMarketingStatus.text = "No active Marketing employees are available."
            updateMarketingSelectionUi()
            return
        }

        b.tvMarketingStatus.text =
            "Choose one or more people. Fireblade opens each selected WhatsApp chat with the message ready."

        marketingRecipients.forEach { recipient ->
            val row = layoutInflater.inflate(
                R.layout.row_shane_marketing_recipient,
                b.marketingEmployeeList,
                false
            )
            val root = row.findViewById<android.view.View>(R.id.marketingRowRoot)
            val initials = row.findViewById<TextView>(R.id.tvMarketingInitials)
            val name = row.findViewById<TextView>(R.id.tvMarketingName)
            val availability = row.findViewById<TextView>(R.id.tvMarketingAvailability)
            val checkbox = row.findViewById<CheckBox>(R.id.cbMarketingSelect)

            initials.text = marketingInitials(recipient.employeeName)
            name.text = recipient.employeeName
            availability.text =
                if (recipient.available && recipient.phoneNumber.isNotBlank()) {
                    "Ready on WhatsApp"
                } else {
                    "WhatsApp number unavailable"
                }

            val available = recipient.available && recipient.phoneNumber.isNotBlank()
            checkbox.isEnabled = available
            checkbox.isChecked = selectedMarketingEmployeeIds.contains(recipient.employeeId)
            root.isEnabled = available
            root.alpha = if (available) 1f else 0.62f

            fun renderRowState(selected: Boolean) {
                root.setBackgroundResource(
                    when {
                        !available -> R.drawable.bg_shane_employee_row_unavailable
                        selected -> R.drawable.bg_shane_employee_row_selected
                        else -> R.drawable.bg_shane_employee_row
                    }
                )
                availability.setTextColor(
                    when {
                        !available -> android.graphics.Color.parseColor("#8D877E")
                        selected -> android.graphics.Color.parseColor("#174EA6")
                        else -> android.graphics.Color.parseColor("#6B665E")
                    }
                )
            }

            renderRowState(checkbox.isChecked)
            checkbox.setOnCheckedChangeListener { _, checked ->
                if (checked) {
                    selectedMarketingEmployeeIds += recipient.employeeId
                } else {
                    selectedMarketingEmployeeIds -= recipient.employeeId
                }
                renderRowState(checked)
                updateMarketingSelectionUi()
            }
            root.setOnClickListener {
                if (available) checkbox.isChecked = !checkbox.isChecked
            }

            b.marketingEmployeeList.addView(row)
        }

        updateMarketingSelectionUi()
    }

    private fun marketingInitials(name: String): String {
        val parts = name.trim()
            .split(Regex("\\s+"))
            .filter { it.isNotBlank() }
            .take(2)
        return parts.joinToString("") { it.first().uppercaseChar().toString() }
            .ifBlank { "M" }
    }

    private fun updatePriorityUi(urgent: Boolean) {
        b.priorityCard.setBackgroundResource(
            if (urgent) R.drawable.bg_shane_priority_selected
            else R.drawable.bg_shane_priority
        )
        b.tvPriorityLabel.setTextColor(
            android.graphics.Color.parseColor(if (urgent) "#B43A3A" else "#171717")
        )
        b.tvPriorityHint.text =
            if (urgent) "Marked VERY URGENT • immediate action required."
            else "Mark only when immediate action is required."
        b.tvPriorityHint.setTextColor(
            android.graphics.Color.parseColor(if (urgent) "#9A3E3E" else "#7E7A73")
        )
    }

    private fun updateMarketingSelectionUi() {
        val availableIds = marketingRecipients
            .filter { it.available && it.phoneNumber.isNotBlank() }
            .mapTo(hashSetOf()) { it.employeeId }
        selectedMarketingEmployeeIds.retainAll(availableIds)

        val count = selectedMarketingEmployeeIds.size
        b.tvMarketingSelectedBadge.text = "$count selected"
        b.tvMarketingSelectedCount.text =
            if (count == 1) "1 employee selected" else "$count employees selected"
        b.btnSaveSend.text =
            if (count > 0) "Save & Send on WhatsApp • $count selected"
            else "Save & Send on WhatsApp"
    }

    private suspend fun resolveTarget(): CallTarget? {
        if (intent.getBooleanExtra(EXTRA_OPEN_LATEST_SPOKEN, false)) {
            val latest = db.callDao().latestSpoken()
            val live = LiveCallStore.snapshot(this)
                ?.takeIf { it.state == "COMPLETED" && it.hadConversation }

            if (live != null && (latest == null || live.startedAtEpochMs > latest.startedAtEpochMs)) {
                val normalized = PhoneNumberUtil.normalizeIndia(live.phoneNumber)
                return CallTarget(
                    sourceCallId = null,
                    phoneRaw = live.phoneNumber,
                    phoneNormalized = normalized,
                    startedAtEpochMs = live.startedAtEpochMs
                )
            }

            if (latest != null) return latest.toTarget()
        }

        val raw = intent.getStringExtra(EXTRA_PHONE_RAW).orEmpty()
        val normalized = intent.getStringExtra(EXTRA_PHONE_NORMALIZED).orEmpty()
            .ifBlank { PhoneNumberUtil.normalizeIndia(raw) }
        val started = intent.getLongExtra(EXTRA_STARTED_AT, 0L)
        val sourceId = intent.getStringExtra(EXTRA_SOURCE_CALL_ID)?.takeIf { it.isNotBlank() }

        if (raw.isNotBlank() || normalized.isNotBlank() || sourceId != null) {
            val validStarted = if (started > 0L) started else System.currentTimeMillis()
            return CallTarget(
                sourceCallId = sourceId,
                phoneRaw = raw,
                phoneNormalized = normalized,
                startedAtEpochMs = validStarted
            )
        }

        val latest = db.callDao().latestSpoken()
        if (latest != null) return latest.toTarget()

        val live = LiveCallStore.snapshot(this)
        if (live != null && live.phoneNumber.isNotBlank()) {
            val norm = PhoneNumberUtil.normalizeIndia(live.phoneNumber)
            return CallTarget(
                sourceCallId = null,
                phoneRaw = live.phoneNumber,
                phoneNormalized = norm,
                startedAtEpochMs = live.startedAtEpochMs
            )
        }

        return null
    }

    private fun saveAndSend() {
        val call = target ?: return

        val customerName = b.etCustomerName.text?.toString().orEmpty().trim()
        val productAsked = b.etProductAsked.text?.toString().orEmpty().trim()
        val location = b.etLocation.text?.toString().orEmpty().trim()
        val notes = b.etNotes.text?.toString().orEmpty().trim()
        val urgent = b.cbVeryUrgent.isChecked
        val selectedRecipients = marketingRecipients.filter {
            it.available &&
                it.phoneNumber.isNotBlank() &&
                selectedMarketingEmployeeIds.contains(it.employeeId)
        }

        b.btnSaveSend.isEnabled = false
        lifecycleScope.launch {
            val saved = withContext(Dispatchers.IO) {
                val now = System.currentTimeMillis()
                val previous = existing
                val row = if (previous == null) {
                    ShaneCallDetailEntity(
                        sourceCallId = call.sourceCallId,
                        phoneNumberRaw = call.phoneRaw,
                        phoneNumberNormalized = call.phoneNormalized,
                        callStartedAtEpochMs = call.startedAtEpochMs,
                        customerName = customerName,
                        productAsked = productAsked,
                        location = location,
                        notes = notes,
                        veryUrgent = urgent,
                        synced = false,
                        syncState = "PENDING",
                        syncError = null,
                        createdAtEpochMs = now,
                        updatedAtEpochMs = now
                    )
                } else {
                    previous.copy(
                        sourceCallId = call.sourceCallId ?: previous.sourceCallId,
                        phoneNumberRaw = call.phoneRaw,
                        phoneNumberNormalized = call.phoneNormalized,
                        callStartedAtEpochMs = call.startedAtEpochMs,
                        customerName = customerName,
                        productAsked = productAsked,
                        location = location,
                        notes = notes,
                        veryUrgent = urgent,
                        synced = false,
                        syncState = "PENDING",
                        syncError = null,
                        updatedAtEpochMs = now
                    )
                }

                if (previous == null) {
                    val id = db.shaneCallDetailDao().insert(row)
                    if (id <= 0L) {
                        db.shaneCallDetailDao().nearestForCall(
                            call.phoneNormalized,
                            call.startedAtEpochMs - 90_000L,
                            call.startedAtEpochMs + 90_000L,
                            call.startedAtEpochMs
                        ) ?: row
                    } else row.copy(localId = id)
                } else {
                    db.shaneCallDetailDao().update(row)
                    row
                }
            }

            existing = saved
            AutomationScheduler.enqueueSync(this@ShaneCallDetailActivity)
            try {
                com.nunes.callcollector.widgets.CallbackWidgetUpdater.updateAll(this@ShaneCallDetailActivity)
            } catch (_: Exception) { }

            val message = buildMessage(
                customerName = customerName,
                phone = call.phoneRaw.ifBlank { call.phoneNormalized },
                productAsked = productAsked,
                location = location,
                notes = notes,
                urgent = urgent,
                callStartedAtEpochMs = call.startedAtEpochMs
            )

            b.btnSaveSend.isEnabled = true
            if (selectedRecipients.isEmpty()) {
                openWhatsApp(message)
            } else {
                startRecipientQueue(message, selectedRecipients)
            }
        }
    }

    private fun buildMessage(
        customerName: String,
        phone: String,
        productAsked: String,
        location: String,
        notes: String,
        urgent: Boolean,
        callStartedAtEpochMs: Long
    ): String {
        val systemZone = ZoneId.systemDefault()
        val effectiveCallTimestamp = if (callStartedAtEpochMs > 0L) callStartedAtEpochMs else System.currentTimeMillis()
        val systemDateTime = Instant.ofEpochMilli(effectiveCallTimestamp).atZone(systemZone)
        val sentDate = systemDateTime.format(
            DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH)
        )
        val sentTime = systemDateTime.format(
            DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)
        )

        val sections = mutableListOf(
            "Customer Name: $customerName",
            "Customer Number: $phone",
            "Product Asked: $productAsked",
            "Location: $location",
            "Date & Time: $sentDate • $sentTime"
        )
        if (urgent) {
            sections += "Priority: VERY URGENT"
        }
        sections += "Notes: $notes"
        return sections.joinToString("\n\n")
    }

    private fun startRecipientQueue(
        message: String,
        recipients: List<MarketingRecipient>
    ) {
        queuedRecipients = recipients
        queuedMessage = message
        nextQueuedRecipientIndex = 0
        waitingForWhatsAppReturn = false

        chooseWhatsAppPackage { packageName ->
            if (packageName == null) {
                clearRecipientQueue()
                Toast.makeText(
                    this,
                    "WhatsApp or WhatsApp Business is required for direct employee sending.",
                    Toast.LENGTH_LONG
                ).show()
                openGenericShare(message)
                return@chooseWhatsAppPackage
            }
            queuedWhatsAppPackage = packageName
            openNextQueuedRecipient()
        }
    }

    private fun openNextQueuedRecipient() {
        val packageName = queuedWhatsAppPackage ?: return
        if (nextQueuedRecipientIndex >= queuedRecipients.size) {
            finishRecipientQueue()
            return
        }

        val recipient = queuedRecipients[nextQueuedRecipientIndex]
        val position = nextQueuedRecipientIndex + 1
        val total = queuedRecipients.size

        if (launchDirectWhatsApp(queuedMessage, recipient.phoneNumber, packageName)) {
            nextQueuedRecipientIndex += 1
            waitingForWhatsAppReturn = true
            Toast.makeText(
                this,
                "Opening ${recipient.employeeName} • $position of $total",
                Toast.LENGTH_SHORT
            ).show()
        } else {
            Toast.makeText(
                this,
                "Could not open WhatsApp for ${recipient.employeeName}.",
                Toast.LENGTH_LONG
            ).show()
            nextQueuedRecipientIndex += 1
            if (nextQueuedRecipientIndex < queuedRecipients.size) {
                showContinueRecipientDialog()
            } else {
                finishRecipientQueue()
            }
        }
    }

    private fun handleWhatsAppReturn() {
        if (queuedRecipients.isEmpty()) return
        if (nextQueuedRecipientIndex >= queuedRecipients.size) {
            finishRecipientQueue()
        } else {
            showContinueRecipientDialog()
        }
    }

    private fun showContinueRecipientDialog() {
        if (nextQueuedRecipientIndex >= queuedRecipients.size) {
            finishRecipientQueue()
            return
        }
        val next = queuedRecipients[nextQueuedRecipientIndex]
        val position = nextQueuedRecipientIndex + 1
        val total = queuedRecipients.size

        AlertDialog.Builder(this)
            .setTitle("Continue to next employee?")
            .setMessage(
                "Next: ${next.employeeName}\n$position of $total selected\n\n" +
                    "Fireblade opens the chat with the message filled in. " +
                    "It cannot verify whether the previous WhatsApp message was sent."
            )
            .setPositiveButton("Open next") { _, _ -> openNextQueuedRecipient() }
            .setNegativeButton("Stop") { _, _ -> clearRecipientQueue() }
            .setCancelable(false)
            .show()
    }

    private fun finishRecipientQueue() {
        val total = queuedRecipients.size
        clearRecipientQueue()
        if (total > 0) {
            Toast.makeText(
                this,
                "Opened all $total selected employee chats.",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    private fun clearRecipientQueue() {
        queuedRecipients = emptyList()
        queuedMessage = ""
        queuedWhatsAppPackage = null
        nextQueuedRecipientIndex = 0
        waitingForWhatsAppReturn = false
    }

    private fun openWhatsApp(message: String) {
        chooseWhatsAppPackage { packageName ->
            if (packageName != null) {
                if (!launchWhatsAppPackage(message, packageName)) {
                    getSharedPreferences(WHATSAPP_PREFS, Context.MODE_PRIVATE)
                        .edit()
                        .remove(KEY_WHATSAPP_PACKAGE)
                        .apply()
                    openGenericShare(message)
                }
            } else {
                openGenericShare(message)
            }
        }
    }

    private fun chooseWhatsAppPackage(onChosen: (String?) -> Unit) {
        val normalAvailable = canShareTo(WHATSAPP_PACKAGE)
        val businessAvailable = canShareTo(WHATSAPP_BUSINESS_PACKAGE)
        val prefs = getSharedPreferences(WHATSAPP_PREFS, Context.MODE_PRIVATE)
        val remembered = prefs.getString(KEY_WHATSAPP_PACKAGE, null)

        if (!remembered.isNullOrBlank()) {
            if (canShareTo(remembered)) {
                onChosen(remembered)
                return
            }
            prefs.edit().remove(KEY_WHATSAPP_PACKAGE).apply()
        }

        when {
            normalAvailable && businessAvailable -> showWhatsAppChoice(onChosen)
            businessAvailable -> onChosen(WHATSAPP_BUSINESS_PACKAGE)
            normalAvailable -> onChosen(WHATSAPP_PACKAGE)
            else -> onChosen(null)
        }
    }

    private fun showWhatsAppChoice(onChosen: (String?) -> Unit) {
        val options = arrayOf("WhatsApp", "WhatsApp Business")
        var selected = 0
        val rememberChoice = CheckBox(this).apply {
            text = "Remember my choice"
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, 8, pad, 8)
        }

        AlertDialog.Builder(this)
            .setTitle("Send with")
            .setSingleChoiceItems(options, selected) { _, which ->
                selected = which
            }
            .setView(rememberChoice)
            .setPositiveButton("Open") { _, _ ->
                val packageName =
                    if (selected == 1) WHATSAPP_BUSINESS_PACKAGE else WHATSAPP_PACKAGE
                if (rememberChoice.isChecked) {
                    getSharedPreferences(WHATSAPP_PREFS, Context.MODE_PRIVATE)
                        .edit()
                        .putString(KEY_WHATSAPP_PACKAGE, packageName)
                        .apply()
                }
                onChosen(packageName)
            }
            .setNegativeButton("Cancel") { _, _ -> onChosen(null) }
            .setOnCancelListener { onChosen(null) }
            .show()
    }

    private fun canShareTo(packageName: String): Boolean {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            setPackage(packageName)
        }
        return intent.resolveActivity(packageManager) != null
    }

    private fun launchWhatsAppPackage(message: String, packageName: String): Boolean {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, message)
            setPackage(packageName)
        }
        return try {
            startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    private fun launchDirectWhatsApp(
        message: String,
        phoneNumber: String,
        packageName: String
    ): Boolean {
        val normalized = PhoneNumberUtil.normalizeIndia(phoneNumber)
        val digits = normalized.filter { it.isDigit() }
        if (digits.isBlank()) return false

        val uri = Uri.parse(
            "https://wa.me/$digits?text=" + Uri.encode(message)
        )
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            setPackage(packageName)
        }
        return try {
            startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    private fun openGenericShare(message: String) {
        val base = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, message)
        }
        try {
            startActivity(Intent.createChooser(base, "Send customer details"))
        } catch (_: Exception) {
            Toast.makeText(this, "No sharing app is available.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun CallEntity.toTarget() = CallTarget(
        sourceCallId = sourceCallId,
        phoneRaw = numberRaw,
        phoneNormalized = numberNormalized,
        startedAtEpochMs = startedAtEpochMs
    )

    companion object {
        private const val WHATSAPP_PACKAGE = "com.whatsapp"
        private const val WHATSAPP_BUSINESS_PACKAGE = "com.whatsapp.w4b"
        private const val WHATSAPP_PREFS = "shane_whatsapp_preferences"
        private const val KEY_WHATSAPP_PACKAGE = "preferred_package"

        const val EXTRA_OPEN_LATEST_SPOKEN = "open_latest_spoken"
        const val EXTRA_SOURCE_CALL_ID = "source_call_id"
        const val EXTRA_PHONE_RAW = "phone_raw"
        const val EXTRA_PHONE_NORMALIZED = "phone_normalized"
        const val EXTRA_STARTED_AT = "started_at_epoch_ms"
    }
}