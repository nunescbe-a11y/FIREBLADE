package com.nunes.callcollector

import android.content.Context
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.data.CallEntity
import kotlin.math.abs

object ShaneCallReconciler {
    suspend fun reconcile(context: Context, calls: List<CallEntity>) {
        if (!ShaneMode.isEnabled(context) || calls.isEmpty()) return

        val dao = AppDatabase.get(context).shaneCallDetailDao()
        val pending = dao.unlinked(200)
        pending.forEach { detail ->
            val candidates = calls.filter { call ->
                val closeInTime =
                    abs(call.startedAtEpochMs - detail.callStartedAtEpochMs) <= 90_000L
                val numberMatches =
                    detail.phoneNumberNormalized.isBlank() ||
                        call.numberNormalized == detail.phoneNumberNormalized ||
                        call.numberRaw == detail.phoneNumberRaw
                closeInTime && numberMatches
            }
            if (candidates.size == 1) {
                dao.attachSourceCall(
                    detail.detailId,
                    candidates.first().sourceCallId,
                    System.currentTimeMillis()
                )
            }
        }
    }
}
