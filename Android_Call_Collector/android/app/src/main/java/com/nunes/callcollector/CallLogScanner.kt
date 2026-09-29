package com.nunes.callcollector

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.provider.CallLog
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import androidx.core.content.ContextCompat
import com.nunes.callcollector.data.CallEntity
import java.security.MessageDigest

class CallLogScanner(private val context: Context) {
    fun scan(limit: Int = 10000): List<CallEntity> {
        check(ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED) {
            "READ_CALL_LOG not granted"
        }

        val basicProjection = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION
        )
        val extendedProjection = basicProjection + arrayOf(
            CallLog.Calls.PHONE_ACCOUNT_ID,
            CallLog.Calls.PHONE_ACCOUNT_COMPONENT_NAME
        )
        val selection = "${CallLog.Calls.DATE} >= ?"
        val selectionArgs = arrayOf(BackfillPolicy.START_EPOCH_MS.toString())

        // A few OEM call-log providers reject newer projection columns even on
        // supported Android versions. Fall back to the legacy projection so call
        // collection itself never stops merely because SIM metadata is unavailable.
        val cursor = try {
            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                extendedProjection,
                selection,
                selectionArgs,
                "${CallLog.Calls.DATE} DESC"
            )
        } catch (_: Exception) {
            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                basicProjection,
                selection,
                selectionArgs,
                "${CallLog.Calls.DATE} DESC"
            )
        }

        val rows = mutableListOf<CallEntity>()
        cursor?.use { c -> readRows(c, rows, limit) }
        return rows
    }

    private fun readRows(c: Cursor, rows: MutableList<CallEntity>, limit: Int) {
        val idIx = c.getColumnIndexOrThrow(CallLog.Calls._ID)
        val numberIx = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
        val nameIx = c.getColumnIndexOrThrow(CallLog.Calls.CACHED_NAME)
        val typeIx = c.getColumnIndexOrThrow(CallLog.Calls.TYPE)
        val dateIx = c.getColumnIndexOrThrow(CallLog.Calls.DATE)
        val durIx = c.getColumnIndexOrThrow(CallLog.Calls.DURATION)
        val accountIx = c.getColumnIndex(CallLog.Calls.PHONE_ACCOUNT_ID)
        val componentIx = c.getColumnIndex(CallLog.Calls.PHONE_ACCOUNT_COMPONENT_NAME)

        while (c.moveToNext() && rows.size < limit) {
            val providerId = c.getLong(idIx)
            val number = c.getString(numberIx) ?: ""
            val name = c.getString(nameIx)
            val type = c.getInt(typeIx)
            val date = c.getLong(dateIx)
            val duration = c.getLong(durIx)
            val phoneAccountId = if (accountIx >= 0 && !c.isNull(accountIx)) c.getString(accountIx) else null
            val phoneAccountComponent = if (componentIx >= 0 && !c.isNull(componentIx)) c.getString(componentIx) else null
            val sub = resolveSubscription(phoneAccountId)

            val direction = when (type) {
                CallLog.Calls.INCOMING_TYPE -> "INCOMING_ANSWERED"
                CallLog.Calls.MISSED_TYPE -> "INCOMING_MISSED"
                CallLog.Calls.REJECTED_TYPE -> "INCOMING_REJECTED"
                CallLog.Calls.OUTGOING_TYPE -> if (duration > 0) "OUTGOING_CONNECTED" else "OUTGOING_UNANSWERED"
                else -> "OTHER_$type"
            }
            val normalized = PhoneNumberUtil.normalizeIndia(number)
            // Keep the original V1/V1.2 source hash unchanged. App upgrades must
            // not generate duplicates just because SIM metadata was added.
            val source = sha256("$providerId|$normalized|$date|$duration|$type")
            rows += CallEntity(
                sourceCallId = source,
                numberRaw = number,
                numberNormalized = normalized,
                contactName = name,
                direction = direction,
                startedAtEpochMs = date,
                durationSeconds = duration,
                phoneAccountId = phoneAccountId,
                phoneAccountComponent = phoneAccountComponent,
                subscriptionId = sub?.subscriptionId,
                simSlotIndex = sub?.simSlotIndex
            )
        }
    }

    private fun resolveSubscription(phoneAccountId: String?): SubscriptionInfo? {
        if (phoneAccountId.isNullOrBlank()) return null
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return null
        return try {
            val manager = context.getSystemService(SubscriptionManager::class.java)
            val active = manager?.activeSubscriptionInfoList.orEmpty()
            val numericId = phoneAccountId.toIntOrNull()
            active.firstOrNull { numericId != null && it.subscriptionId == numericId }
                ?: active.firstOrNull { it.iccId?.equals(phoneAccountId, ignoreCase = true) == true }
                ?: active.firstOrNull { phoneAccountId.contains(it.subscriptionId.toString()) }
        } catch (_: Exception) {
            null
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }
}
