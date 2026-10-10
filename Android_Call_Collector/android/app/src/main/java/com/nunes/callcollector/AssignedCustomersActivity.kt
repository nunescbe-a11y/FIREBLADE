package com.nunes.callcollector

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.data.AssignedCustomerEntity
import com.nunes.callcollector.databinding.ActivityAssignedCustomersBinding
import com.nunes.callcollector.network.ApiClient
import com.nunes.callcollector.control.DeviceApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AssignedCustomersActivity : AppCompatActivity() {
    private lateinit var b: ActivityAssignedCustomersBinding
    private val config by lazy { ConfigStore(this) }
    private val db by lazy { AppDatabase.get(this) }
    private var refreshJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityAssignedCustomersBinding.inflate(layoutInflater)
        setContentView(b.root)

        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(b.root) { view, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        PremiumNav.bind(this, b.root, PremiumTab.ASSIGNED)
        b.btnBack.setOnClickListener { finish() }
        b.btnRefresh.setOnClickListener { refresh() }
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    override fun onDestroy() {
        refreshJob?.cancel()
        super.onDestroy()
    }

    private fun refresh() {
        refreshJob?.cancel()
        refreshJob = lifecycleScope.launch {
            b.tvSourceStatus.text = "Synchronizing assigned customers..."
            val localCustomers = withContext(Dispatchers.IO) {
                db.assignedCustomerDao().getAll()
            }
            render(localCustomers)

            if (config.deviceToken.isNotBlank() && config.apiUrl.startsWith("https://")) {
                val (serverCustomers, syncError) = withContext(Dispatchers.IO) {
                    try {
                        val fetched = ApiClient.getAssignedCustomers(config)
                        // The legacy API parser silently returns an empty list on HTTP errors.
                        // Verify an empty response directly so employees see the real cause.
                        if (fetched.isEmpty()) {
                            val response = DeviceApi.request(
                                config,
                                DeviceApi.devicePath(config) + "/assigned-customers"
                            )
                            val expected = response.optJSONArray("assigned_customers")
                                ?: error("Invalid assigned-customer response")
                            check(expected.length() == 0) {
                                "Server has ${expected.length()} assigned customers but the installed app cannot read them. Update Fireblade."
                            }
                        }
                        if (fetched.isNotEmpty()) {
                            fetched.forEach { remote ->
                                val existing = db.assignedCustomerDao().getByDetailId(remote.detailId)
                                if (existing == null) {
                                    db.assignedCustomerDao().insert(remote)
                                    ApiClient.sendAssignmentReceipt(config, remote.detailId, "RECEIVED_ON_APP")
                                } else if (existing.syncState == "SYNCED") {
                                    db.assignedCustomerDao().update(
                                        existing.copy(
                                            customerName = remote.customerName,
                                            customerPhoneRaw = remote.customerPhoneRaw,
                                            customerPhoneNormalized = remote.customerPhoneNormalized,
                                            productAsked = remote.productAsked,
                                            location = remote.location,
                                            shaneNotes = remote.shaneNotes,
                                            veryUrgent = remote.veryUrgent,
                                            assignedAtEpochMs = remote.assignedAtEpochMs,
                                            status = remote.status,
                                            quotation = remote.quotation,
                                            catalogue = remote.catalogue,
                                            image = remote.image,
                                            commonRemarks = remote.commonRemarks,
                                            savedAtEpochMs = remote.savedAtEpochMs
                                        )
                                    )
                                }
                            }
                        }
                        Pair(db.assignedCustomerDao().getAll(), null)
                    } catch (e: Exception) {
                        Pair(null, e.message ?: e.javaClass.simpleName)
                    }
                }
                if (serverCustomers != null) {
                    render(serverCustomers)
                    b.tvSourceStatus.text = "Assigned customers synced with Fireblade"
                } else {
                    b.tvSourceStatus.text = "Sync failed: ${syncError ?: "Unknown error"}. Tap Retry customer sync."
                }
            } else {
                b.tvSourceStatus.text = "Device is not enrolled or Fireblade API is not configured. Check Advanced Admin."
            }
        }
    }

    private fun render(customers: List<AssignedCustomerEntity>) {
        b.tvSummary.text = if (customers.isEmpty()) {
            "No customers assigned yet"
        } else {
            "${customers.size} assigned customer${if (customers.size == 1) "" else "s"}"
        }

        b.assignedList.removeAllViews()
        b.emptyState.visibility = if (customers.isEmpty()) View.VISIBLE else View.GONE

        customers.forEach { customer ->
            val view = LayoutInflater.from(this).inflate(R.layout.row_assigned_customer_card, b.assignedList, false)
            
            view.findViewById<TextView>(R.id.tvCustomerName).text = customer.customerName.ifBlank { "Unnamed Customer" }
            // Show the exact Shane WhatsApp field order and labels inside Fireblade.
            // Follow-up checkboxes belong to this employee and must not alter
            // the original customer message displayed in this section.
            view.findViewById<TextView>(R.id.tvAssignmentMessage).text =
                ShaneCustomerMessageFormatter.format(
                    customerName = customer.customerName,
                    phone = customer.customerPhoneRaw.ifBlank { customer.customerPhoneNormalized },
                    productAsked = customer.productAsked,
                    location = customer.location,
                    notes = customer.shaneNotes,
                    quotation = false,
                    catalogue = false,
                    image = false,
                    veryUrgent = customer.veryUrgent,
                    callStartedAtEpochMs = customer.callStartedAtEpochMs
                )

            val tvUrgentBadge = view.findViewById<TextView>(R.id.tvUrgentBadge)
            tvUrgentBadge.visibility = if (customer.veryUrgent) View.VISIBLE else View.GONE

            val tvStatusBadge = view.findViewById<TextView>(R.id.tvStatusBadge)
            if (customer.status == "COMPLETED" || customer.savedAtEpochMs != null) {
                tvStatusBadge.text = "Details Saved"
                tvStatusBadge.setTextColor(android.graphics.Color.parseColor("#16794B"))
                tvStatusBadge.setBackgroundResource(R.drawable.bg_premium_success_soft)
            } else {
                tvStatusBadge.text = "Pending Follow-up"
                tvStatusBadge.setTextColor(android.graphics.Color.parseColor("#174EA6"))
                tvStatusBadge.setBackgroundResource(R.drawable.bg_chip_pending)
            }

            view.findViewById<TextView>(R.id.tvSourceTag).text = customer.sourceTitle
            view.findViewById<TextView>(R.id.tvAssignedTime).text = if (customer.assignedAtEpochMs > 0) {
                FirebladeDatePolicy.displayDateTime(customer.assignedAtEpochMs)
            } else {
                ""
            }

            val summaryLayout = view.findViewById<View>(R.id.savedDetailsSummary)
            if (customer.savedAtEpochMs != null) {
                summaryLayout.visibility = View.VISIBLE
                val checklist = listOfNotNull(
                    if (customer.quotation) "Quotation: Yes" else "Quotation: No",
                    if (customer.catalogue) "Catalogue: Yes" else "Catalogue: No",
                    if (customer.image) "Images: Yes" else "Images: No"
                ).joinToString("  •  ")
                view.findViewById<TextView>(R.id.tvSavedCheckboxes).text = checklist
                
                val tvRemarks = view.findViewById<TextView>(R.id.tvSavedRemarks)
                if (customer.commonRemarks.isNotBlank()) {
                    tvRemarks.text = "Remarks: ${customer.commonRemarks}"
                    tvRemarks.visibility = View.VISIBLE
                } else {
                    tvRemarks.visibility = View.GONE
                }

                view.findViewById<TextView>(R.id.tvSavedTimestamp).text = "Saved at: ${FirebladeDatePolicy.displayDateTime(customer.savedAtEpochMs)}"
            } else {
                summaryLayout.visibility = View.GONE
            }

            view.setOnClickListener {
                showFollowUpDialog(customer)
            }

            b.assignedList.addView(view)
        }
    }

    private fun showFollowUpDialog(customer: AssignedCustomerEntity) {
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_assigned_customer_followup, null, false)

        dialogView.findViewById<TextView>(R.id.tvDialogTitle).text = customer.customerName.ifBlank { "Customer Details" }
        dialogView.findViewById<TextView>(R.id.tvDialogPhone).text = customer.customerPhoneRaw.ifBlank { customer.customerPhoneNormalized }
        
        val meta = listOfNotNull(
            customer.productAsked.takeIf { it.isNotBlank() },
            customer.location.takeIf { it.isNotBlank() },
            if (customer.assignedAtEpochMs > 0) "Assigned: " + FirebladeDatePolicy.displayDateTime(customer.assignedAtEpochMs) else null
        ).joinToString("  •  ")
        dialogView.findViewById<TextView>(R.id.tvDialogMeta).text = meta

        val tvNotes = dialogView.findViewById<TextView>(R.id.tvDialogShaneNotes)
        if (customer.shaneNotes.isNotBlank()) {
            tvNotes.text = "Shane Notes:\n${customer.shaneNotes}"
            tvNotes.visibility = View.VISIBLE
        } else {
            tvNotes.visibility = View.GONE
        }

        val cbQuotation = dialogView.findViewById<CheckBox>(R.id.cbQuotation)
        val cbImages = dialogView.findViewById<CheckBox>(R.id.cbImages)
        val cbCatalogue = dialogView.findViewById<CheckBox>(R.id.cbCatalogue)
        val etRemarks = dialogView.findViewById<EditText>(R.id.etCommonRemarks)

        cbQuotation.isChecked = customer.quotation
        cbImages.isChecked = customer.image
        cbCatalogue.isChecked = customer.catalogue
        etRemarks.setText(customer.commonRemarks)

        dialogView.findViewById<View>(R.id.rowQuotation).setOnClickListener { cbQuotation.isChecked = !cbQuotation.isChecked }
        dialogView.findViewById<View>(R.id.rowImages).setOnClickListener { cbImages.isChecked = !cbImages.isChecked }
        dialogView.findViewById<View>(R.id.rowCatalogue).setOnClickListener { cbCatalogue.isChecked = !cbCatalogue.isChecked }

        val dialog = MaterialAlertDialogBuilder(this)
            .setView(dialogView)
            .setPositiveButton("Save Details", null)
            .setNegativeButton("Cancel", null)
            .create()

        // Keep the form open if Common Remarks are missing for any No response.
        // Record ONE timestamp only after the complete response is validated.
        dialog.setOnShowListener {
            dialog.getButton(android.content.DialogInterface.BUTTON_POSITIVE).setOnClickListener {
                val remarks = etRemarks.text.toString().trim()
                if ((!cbQuotation.isChecked || !cbImages.isChecked || !cbCatalogue.isChecked) && remarks.isBlank()) {
                    etRemarks.error = "Common Remarks are required when any item is No"
                    etRemarks.requestFocus()
                } else {
                    saveDetails(
                        customer = customer,
                        quotation = cbQuotation.isChecked,
                        images = cbImages.isChecked,
                        catalogue = cbCatalogue.isChecked,
                        remarks = remarks
                    )
                    dialog.dismiss()
                }
            }
        }
        dialog.show()
    }

    private fun saveDetails(
        customer: AssignedCustomerEntity,
        quotation: Boolean,
        images: Boolean,
        catalogue: Boolean,
        remarks: String
    ) {
        val now = System.currentTimeMillis()
        val updated = customer.copy(
            quotation = quotation,
            image = images,
            catalogue = catalogue,
            commonRemarks = remarks,
            savedAtEpochMs = now,
            status = "COMPLETED",
            syncState = "PENDING_SAVE",
            clientUpdatedAtEpochMs = now
        )

        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                db.assignedCustomerDao().update(updated)
            }
            AutomationScheduler.enqueueSync(this@AssignedCustomersActivity)
            Toast.makeText(this@AssignedCustomersActivity, "Details saved and syncing", Toast.LENGTH_SHORT).show()
            refresh()
        }
    }
}
