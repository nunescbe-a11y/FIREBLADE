package com.nunes.callcollector

import android.content.Context
import com.nunes.callcollector.data.CallEntity
import java.util.UUID
import kotlin.math.abs

data class LiveCallSnapshot(
    val sessionId: String,
    val state: String,
    val direction: String,
    val phoneNumber: String,
    val startedAtEpochMs: Long,
    val connectedAtEpochMs: Long,
    val endedAtEpochMs: Long
) {
    val hadConversation: Boolean get() = connectedAtEpochMs > 0L
    val isActive: Boolean get() = state == "RINGING" || state == "CONNECTED"
    val durationSeconds: Long
        get() {
            if (!hadConversation) return 0L
            val end = if (endedAtEpochMs > 0L) endedAtEpochMs else System.currentTimeMillis()
            return ((end - connectedAtEpochMs).coerceAtLeast(0L) / 1000L)
        }
}

object LiveCallStore {
    private const val PREFS = "fireblade_live_call"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun snapshot(context: Context): LiveCallSnapshot? {
        val p = prefs(context)
        val sessionId = p.getString("session_id", "").orEmpty()
        if (sessionId.isBlank()) return null
        return LiveCallSnapshot(
            sessionId = sessionId,
            state = p.getString("state", "").orEmpty(),
            direction = p.getString("direction", "").orEmpty(),
            phoneNumber = p.getString("phone_number", "").orEmpty(),
            startedAtEpochMs = p.getLong("started_at", 0L),
            connectedAtEpochMs = p.getLong("connected_at", 0L),
            endedAtEpochMs = p.getLong("ended_at", 0L)
        )
    }

    fun onRinging(context: Context, number: String?) {
        val now = System.currentTimeMillis()
        prefs(context).edit()
            .putString("session_id", UUID.randomUUID().toString())
            .putString("state", "RINGING")
            .putString("direction", "INCOMING")
            .putString("phone_number", number.orEmpty())
            .putLong("started_at", now)
            .putLong("connected_at", 0L)
            .putLong("ended_at", 0L)
            .apply()
    }

    fun onOutgoingNumber(context: Context, number: String?) {
        val current = snapshot(context)
        val now = System.currentTimeMillis()
        if (current == null || !current.isActive || current.direction != "OUTGOING") {
            prefs(context).edit()
                .putString("session_id", UUID.randomUUID().toString())
                .putString("state", "DIALING")
                .putString("direction", "OUTGOING")
                .putString("phone_number", number.orEmpty())
                .putLong("started_at", now)
                .putLong("connected_at", 0L)
                .putLong("ended_at", 0L)
                .apply()
        } else if (!number.isNullOrBlank() && current.phoneNumber.isBlank()) {
            prefs(context).edit().putString("phone_number", number).apply()
        }
    }

    fun onOffhook(context: Context, previousState: String, number: String?) {
        val current = snapshot(context)
        val now = System.currentTimeMillis()
        val incoming = previousState == android.telephony.TelephonyManager.EXTRA_STATE_RINGING ||
            current?.direction == "INCOMING"
        val direction = if (incoming) "INCOMING" else "OUTGOING"

        val editor = prefs(context).edit()
        if (current == null || (!current.isActive && current.state != "DIALING")) {
            editor
                .putString("session_id", UUID.randomUUID().toString())
                .putLong("started_at", now)
                .putLong("ended_at", 0L)
        }
        editor
            .putString("state", "CONNECTED")
            .putString("direction", direction)
            .putLong(
                "connected_at",
                if ((current?.connectedAtEpochMs ?: 0L) > 0L) current!!.connectedAtEpochMs else now
            )

        if (!number.isNullOrBlank()) editor.putString("phone_number", number)
        editor.apply()
    }

    fun enrichNumber(context: Context, number: String?) {
        if (number.isNullOrBlank()) return
        val current = snapshot(context) ?: return
        if (current.phoneNumber.isBlank()) {
            prefs(context).edit().putString("phone_number", number).apply()
        }
    }

    fun onIdle(context: Context) {
        val current = snapshot(context) ?: return
        prefs(context).edit()
            .putString("state", "COMPLETED")
            .putLong("ended_at", System.currentTimeMillis())
            .apply()
    }

    fun clearIfMatched(context: Context, calls: List<CallEntity>) {
        val live = snapshot(context) ?: return
        if (live.state != "COMPLETED") return
        val liveNorm = PhoneNumberUtil.normalizeIndia(live.phoneNumber)
        val matched = calls.any { call ->
            val closeInTime = abs(call.startedAtEpochMs - live.startedAtEpochMs) <= 90_000L
            val numberMatches = liveNorm.isBlank() ||
                call.numberNormalized == liveNorm ||
                call.numberRaw == live.phoneNumber
            closeInTime && numberMatches
        }
        if (matched) prefs(context).edit().clear().apply()
    }
}
