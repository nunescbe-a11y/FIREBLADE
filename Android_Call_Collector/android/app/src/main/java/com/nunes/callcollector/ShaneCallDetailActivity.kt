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
import com.nunes.callcollector.data.ShaneAssignmentEventEntity
import androidx.room.withTransaction
import org.json.JSONArray
import org.json.JSONObject
import com.nunes.callcollector.databinding.ActivityShaneCallDetailBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
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
    private val assignmentWriter = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private data class CallTarget(
        val sourceCallId: String?,
        val phoneRaw: String,
        val phoneNormalized: String,
        val startedAtEpochMs: Long
    )

    private var target: CallTarget? = null
    private var existing: ShaneCallDetailEntity? = null

    private var marketingRecipients: List<MarketingRecipient> = emptyList()
    private var marketingRecipientsRendered = false
    private val selectedMarketingEmployeeIds = linkedSetOf<String>()

    private var queuedRecipients: List<MarketingRecipient> = emptyList()
    private var queuedMessage: String = ""
    private var queuedWhatsAppPackage: String? = null
    private var nextQueuedRecipientIndex: Int = 0
    private var waitingForWhatsAppReturn: Boolean = false
    private var queuedDetailId: String? = null
    private var queuedFormSnapshot: String = "{}"

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
        b.rowQuotation.setOnClickListener { b.cbQuotation.isChecked = !b.cbQuotation.isChecked }
        b.rowCatalogue.setOnClickListener { b.cbCatalogue.isChecked = !b.cbCatalogue.isChecked }
        b.rowImage.setOnClickListener { b.cbImage.isChecked = !b.cbImage.isChecked }

        val isShaneRecipientDevice = ShaneMode.isShaneRecipientDevice(this)
        b.priorityCard.visibility = if (isShaneRecipientDevice) android.view.View.VISIBLE else android.view.View.GONE
        if (isShaneRecipientDevice) {
            b.rowQuotation.visibility = android.view.View.GONE
            b.rowCatalogue.visibility = android.view.View.GONE
            b.rowImage.visibility = android.view.View.GONE
        }
        if (!isShaneRecipientDevice) {
            b.marketingRecipientSection.visibility = android.view.View.GONE
            b.tvMarketingSelectedCount.visibility = android.view.View.GONE
            b.btnSaveSend.text = "Save Details"
        }

        val immediateNumber = intent.getStringExtra(EXTRA_PHONE_RAW).orEmpty()
            .ifBlank { intent.getStringExtra(EXTRA_PHONE_NORMALIZED).orEmpty() }
        b.tvPhone.text = immediateNumber.ifBlank { "Preparing latest customer..." }

        if (isShaneRecipientDevice) {
            loadMarketingRecipients()
        }

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

            val rawNotes = current?.notes.orEmpty()
            val (cleanedNotes, legQuotation, legCatalogue, legImage) = parseNotesCheckboxes(rawNotes)
            b.etNotes.setText(cleanedNotes)
            b.cbQuotation.isChecked = current?.quotation == true || legQuotation
            b.cbCatalogue.isChecked = current?.catalogue == true || legCatalogue
            b.cbImage.isChecked = current?.image == true || legImage
            b.cbVeryUrgent.isChecked = isShaneRecipientDevice && current?.veryUrgent == true
        }
    }

    private fun parseNotesCheckboxes(notes: String): CheckboxParseResult {
        var reqQuotation = false
        var reqCatalogue = false
        var reqImage = false
        var cleaned = notes

        val regex = Regex("""\[Required:\s*([^\]]+)\]""")
        val match = regex.find(notes)
        if (match != null) {
            val items = match.groupValues[1].split(",").map { it.trim().lowercase() }
            if (items.contains("quotation")) reqQuotation = true
            if (items.contains("catalogue")) reqCatalogue = true
            if (items.contains("image")) reqImage = true
            cleaned = notes.removeRange(match.range).trim()
        }
        return CheckboxParseResult(cleaned, reqQuotation, reqCatalogue, reqImage)
    }

    private data class CheckboxParseResult(
        val cleanedNotes: String,
        val quotation: Boolean,
        val catalogue: Boolean,
        val image: Boolean
    )

    override fun onResume() {
        super.onResume()
        if (waitingForWhatsAppReturn) {
            waitingForWhatsAppReturn = false
            handleWhatsAppReturn()
        }
    }

    private fun loadMarketingRecipients() {
        val cached = ShaneMarketingApi.getCachedRecipients(this)
        if (cached.isNotEmpty()) {
            marketingRecipients = cached
            renderMarketingRecipients()
            // The list is already on screen; do not show loading or call the API on every entry.
            if (ShaneMarketingApi.isCacheFresh(this)) return
        }

        lifecycleScope.launch {
            try {
                val recipients = withContext(Dispatchers.IO) {
                    ShaneMarketingApi.load(this@ShaneCallDetailActivity, config)
                }
                // Only reconstruct row views if the backend actually changed the recipients.
                // Otherwise keep checkbox selections and eliminate a visible refresh flicker.
                if (!marketingRecipientsRendered || recipients != marketingRecipients) {
                    marketingRecipients = recipients
                    renderMarketingRecipients()
                }
            } catch (_: Exception) {
                if (marketingRecipients.isEmpty()) {
                    marketingRecipients = emptyList()
                    selectedMarketingEmployeeIds.clear()
                    b.marketingEmployeeList.removeAllViews()
                    b.tvMarketingStatus.text =
                        "Marketing employee list is temporarily unavailable. You can still save and open WhatsApp manually."
                    updateMarketingSelectionUi()
                }
            }
        }
    }

    private fun renderMarketingRecipients() {
        marketingRecipientsRendered = true
        b.marketingEmployeeList.removeAllViews()

        if (marketingRecipients.isEmpty()) {
            b.tvMarketingStatus.text = "No active Marketing employees are available."
            updateMarketingSelectionUi()
            return
        }

        b.tvMarketingStatus.text = "No active Marketing employees are available."
            updateMarketingSelectionUi()
            return
        }

        b.tvMarketingStatus.text =
            "Choose employees to assign in Fireblade. WhatsApp opens for selected employees with a WhatsApp number."

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
                    "Fireblade + WhatsApp"
                } else {
                    "Fireblade only • WhatsApp number unavailable"
                }

            // Employees returned by the authorized API can be selected even
            // without a WhatsApp number. Assignment does not depend on WhatsApp.
            val available = true
            checkbox.isEnabled = true
            checkbox.isChecked = selectedMarketingEmployeeIds.contains(recipient.employeeId)
            root.isEnabled = true
            root.alpha = 1f

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

    private fun updateMarketingSelectionUi() {
        if (!ShaneMode.isShaneRecipientDevice(this)) {
            b.btnSaveSend.text = "Save Details"
            return
        }
        val availableIds = marketingRecipients.mapTo(hashSetOf()) { it.employeeId }
        selectedMarketingEmployeeIds.retainAll(availableIds)

        val count = selectedMarketingEmployeeIds.size
        b.tvMarketingSelectedBadge.text = "$count selected"
        b.tvMarketingSelectedCount.text =
            if (count == 1) "1 employee selected" else "$count employees selected"
        b.btnSaveSend.text =
            if (count > 0) "Save, Assign & Send • $count selected"
            else "Save Details"
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
        val isShaneRecipientDevice = ShaneMode.isShaneRecipientDevice(this)
        val quotation = !isShaneRecipientDevice && b.cbQuotation.isChecked
        val catalogue = !isShaneRecipientDevice && b.cbCatalogue.isChecked
        val image = !isShaneRecipientDevice && b.cbImage.isChecked
        val urgent = isShaneRecipientDevice && b.cbVeryUrgent.isChecked
        val selectedRecipients = if (isShaneRecipientDevice) {
            marketingRecipients.filter { selectedMarketingEmployeeIds.contains(it.employeeId) }
        } else emptyList()

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
                        quotation = quotation,
                        catalogue = catalogue,
                        image = image,
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
                        quotation = quotation,
                        catalogue = catalogue,
                        image = image,
                        // Do not erase historical urgency from other devices while hiding its control.
                        veryUrgent = if (isShaneRecipientDevice) urgent else previous.veryUrgent,
                        synced = false,
                        syncState = "PENDING",
                        syncError = null,
                        updatedAtEpochMs = now
                    )
                }

                // Save the form and ALL employee selections atomically on-device.
                // The events survive loss of signal and will retry with stable UUIDs.
                db.withTransaction {
                    val savedRow = if (previous == null) {
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
                    if (isShaneRecipientDevice) {
                        val snapshot = shaneSnapshot(savedRow, selectedRecipients).toString()
                        selectedRecipients.forEach { employee ->
                            db.shaneAssignmentEventDao().insert(ShaneAssignmentEventEntity(
                                detailId = savedRow.detailId,
                                assignedToEmployeeId = employee.employeeId,
                                eventType = "ASSIGNED",
                                occurredAtEpochMs = now,
                                whatsappRecipientNumber = employee.phoneNumber,
                                formSnapshotJson = snapshot
                            ))
                        }
                    }
                    savedRow
                }
            }

            existing = saved
            AutomationScheduler.enqueueSync(this@ShaneCallDetailActivity)
            try {
                com.nunes.callcollector.widgets.CallbackWidgetUpdater.updateAll(this@ShaneCallDetailActivity)
            } catch (_: Exception) { }

            b.btnSaveSend.isEnabled = true

            if (!isShaneRecipientDevice) {
                Toast.makeText(this@ShaneCallDetailActivity, "Details saved and syncing to Fireblade portal", Toast.LENGTH_SHORT).show()
                finish()
                return@launch
            }

            val message = buildMessage(
                customerName = customerName,
                phone = call.phoneRaw.ifBlank { call.phoneNormalized },
                productAsked = productAsked,
                location = location,
                notes = notes,
                quotation = quotation,
                catalogue = catalogue,
                image = image,
                veryUrgent = urgent,
                callStartedAtEpochMs = call.startedAtEpochMs
            )

            if (selectedRecipients.isEmpty()) {
                // No in-app assignment without an explicitly chosen recipient.
                openWhatsApp(message)
            } else {
                val whatsappRecipients = selectedRecipients.filter {
                    it.available && it.phoneNumber.isNotBlank()
                }
                Toast.makeText(
                    this@ShaneCallDetailActivity,
                    "Assigned to ${selectedRecipients.size} employee(s) in Fireblade. Syncing...",
                    Toast.LENGTH_LONG
                ).show()
                if (whatsappRecipients.isNotEmpty()) {
                    startRecipientQueue(message, whatsappRecipients, saved)
                } else {
                    // Assignment was saved for every selected employee even when
                    // no WhatsApp destination is configured.
                    finish()
                }
            }
        }
    }

    private fun shaneSnapshot(
        row: ShaneCallDetailEntity,
        recipients: List<MarketingRecipient>
    ): JSONObject = JSONObject().apply {
        put("detail_id", row.detailId)
        put("source_call_id", row.sourceCallId ?: JSONObject.NULL)
        put("phone_number_raw", row.phoneNumberRaw)
        put("phone_number_normalized", row.phoneNumberNormalized)
        put("call_started_at_epoch_ms", row.callStartedAtEpochMs)
        put("customer_name", row.customerName)
        put("product_asked", row.productAsked)
        put("location", row.location)
        put("notes", row.notes)
        put("very_urgent", row.veryUrgent)
        put("client_updated_at_epoch_ms", row.updatedAtEpochMs)
        put("selected_employee_ids", JSONArray(recipients.map { it.employeeId }))
    }

    private fun rememberWhatsAppHandoff(recipient: MarketingRecipient) {
        val detailId = queuedDetailId ?: return
        val snapshot = queuedFormSnapshot
        val appContext = applicationContext
        // Runs on the database dispatcher, not on the WhatsApp UI thread.
        assignmentWriter.launch {
            db.shaneAssignmentEventDao().insert(ShaneAssignmentEventEntity(
                detailId = detailId,
                assignedToEmployeeId = recipient.employeeId,
                eventType = "WHATSAPP_HANDOFF_OPENED",
                occurredAtEpochMs = System.currentTimeMillis(),
                whatsappRecipientNumber = recipient.phoneNumber,
                formSnapshotJson = snapshot
            ))
            AutomationScheduler.enqueueSync(appContext)
        }
    }

    private fun buildMessage(
        customerName: String,
        phone: String,
        productAsked: String,
        location: String,
        notes: String,
        quotation: Boolean,
        catalogue: Boolean,
        image: Boolean,
        veryUrgent: Boolean,
        callStartedAtEpochMs: Long
    ): String = ShaneCustomerMessageFormatter.format(
        customerName = customerName,
        phone = phone,
        productAsked = productAsked,
        location = location,
        notes = notes,
        quotation = quotation,
        catalogue = catalogue,
        image = image,
        veryUrgent = veryUrgent,
        callStartedAtEpochMs = callStartedAtEpochMs
    )

    private fun startRecipientQueue(
        message: String,
        recipients: List<MarketingRecipient>,
        saved: ShaneCallDetailEntity
    ) {
        queuedDetailId = saved.detailId
        queuedFormSnapshot = shaneSnapshot(saved, recipients).toString()
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
            rememberWhatsAppHandoff(recipient)
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
        queuedDetailId = null
        queuedFormSnapshot = "{}"
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

/**
 * Single message format for Shane's WhatsApp handoff and the selected employee's
 * Assigned Customers card. Both render from the same saved customer fields.
 * IST keeps the displayed call date/time consistent between devices.
 */
internal object ShaneCustomerMessageFormatter {
    fun format(
        customerName: String,
        phone: String,
        productAsked: String,
        location: String,
        notes: String,
        quotation: Boolean,
        catalogue: Boolean,
        image: Boolean,
        veryUrgent: Boolean,
        callStartedAtEpochMs: Long
    ): String {
        val effectiveCallTimestamp = if (callStartedAtEpochMs > 0L) callStartedAtEpochMs else System.currentTimeMillis()
        val sentDateTime = Instant.ofEpochMilli(effectiveCallTimestamp).atZone(ZoneId.of("Asia/Kolkata"))
        val sentDate = sentDateTime.format(DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH))
        val sentTime = sentDateTime.format(DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH))

        val sections = mutableListOf(
            "Customer Name: $customerName",
            "Customer Number: $phone",
            "Product Asked: $productAsked",
            "Location: $location",
            "Date & Time: $sentDate • $sentTime"
        )
        if (veryUrgent) sections += "Priority: VERY URGENT"
        val infoItems = mutableListOf<String>()
        if (quotation) infoItems += "Quotation"
        if (catalogue) infoItems += "Catalogue"
        if (image) infoItems += "Image"
        if (infoItems.isNotEmpty()) sections += "Required: ${infoItems.joinToString(", ")}"
        if (notes.isNotBlank()) sections += "Notes: $notes"
        return sections.joinToString("\n\n")
    }
}
