package com.nunes.callcollector

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.data.CallEntity
import com.nunes.callcollector.data.ShaneCallDetailEntity
import com.nunes.callcollector.databinding.ActivityShaneCallDetailBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ShaneCallDetailActivity : AppCompatActivity() {
    private lateinit var b: ActivityShaneCallDetailBinding
    private val db by lazy { AppDatabase.get(this) }

    private data class CallTarget(
        val sourceCallId: String?,
        val phoneRaw: String,
        val phoneNormalized: String,
        val startedAtEpochMs: Long
    )

    private var target: CallTarget? = null
    private var existing: ShaneCallDetailEntity? = null

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

        val immediateNumber = intent.getStringExtra(EXTRA_PHONE_RAW).orEmpty()
            .ifBlank { intent.getStringExtra(EXTRA_PHONE_NORMALIZED).orEmpty() }
        b.tvPhone.text = immediateNumber.ifBlank { "Preparing latest customer..." }

        lifecycleScope.launch {
            val resolved = withContext(Dispatchers.IO) { resolveTarget() }
            if (resolved == null) {
                Toast.makeText(
                    this@ShaneCallDetailActivity,
                    "No completed spoken call is available yet.",
                    Toast.LENGTH_SHORT
                ).show()
                finish()
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

    private suspend fun resolveTarget(): CallTarget? {
        if (intent.getBooleanExtra(EXTRA_OPEN_LATEST_SPOKEN, false)) {
            val latest = db.callDao().latestSpoken()
            if (latest != null) return latest.toTarget()

            val live = LiveCallStore.snapshot(this)
            if (live != null && live.state == "COMPLETED" && live.hadConversation) {
                val normalized = PhoneNumberUtil.normalizeIndia(live.phoneNumber)
                return CallTarget(
                    sourceCallId = null,
                    phoneRaw = live.phoneNumber,
                    phoneNormalized = normalized,
                    startedAtEpochMs = live.startedAtEpochMs
                )
            }
            return null
        }

        val raw = intent.getStringExtra(EXTRA_PHONE_RAW).orEmpty()
        val normalized = intent.getStringExtra(EXTRA_PHONE_NORMALIZED).orEmpty()
            .ifBlank { PhoneNumberUtil.normalizeIndia(raw) }
        val started = intent.getLongExtra(EXTRA_STARTED_AT, 0L)
        if (started <= 0L) return null
        return CallTarget(
            sourceCallId = intent.getStringExtra(EXTRA_SOURCE_CALL_ID)?.takeIf { it.isNotBlank() },
            phoneRaw = raw,
            phoneNormalized = normalized,
            startedAtEpochMs = started
        )
    }

    private fun saveAndSend() {
        val call = target ?: return

        val customerName = b.etCustomerName.text?.toString().orEmpty().trim()
        val productAsked = b.etProductAsked.text?.toString().orEmpty().trim()
        val location = b.etLocation.text?.toString().orEmpty().trim()
        val notes = b.etNotes.text?.toString().orEmpty().trim()
        val urgent = b.cbVeryUrgent.isChecked

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

            openWhatsApp(
                buildMessage(
                    customerName = customerName,
                    phone = call.phoneRaw.ifBlank { call.phoneNormalized },
                    productAsked = productAsked,
                    location = location,
                    notes = notes,
                    urgent = urgent
                )
            )
            b.btnSaveSend.isEnabled = true
        }
    }

    private fun buildMessage(
        customerName: String,
        phone: String,
        productAsked: String,
        location: String,
        notes: String,
        urgent: Boolean
    ): String {
        val lines = mutableListOf(
            "Customer Name: $customerName",
            "Phone: $phone",
            "Product Asked: $productAsked",
            "Location: $location"
        )
        if (urgent) lines += "Priority: VERY URGENT"
        lines += ""
        lines += "Notes:"
        lines += notes
        return lines.joinToString("\n")
    }

    private fun openWhatsApp(message: String) {
        val base = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, message)
        }

        try {
            startActivity(Intent(base).setPackage("com.whatsapp"))
            return
        } catch (_: ActivityNotFoundException) { }

        try {
            startActivity(Intent(base).setPackage("com.whatsapp.w4b"))
            return
        } catch (_: ActivityNotFoundException) { }

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
        const val EXTRA_OPEN_LATEST_SPOKEN = "open_latest_spoken"
        const val EXTRA_SOURCE_CALL_ID = "source_call_id"
        const val EXTRA_PHONE_RAW = "phone_raw"
        const val EXTRA_PHONE_NORMALIZED = "phone_normalized"
        const val EXTRA_STARTED_AT = "started_at_epoch_ms"
    }
}
