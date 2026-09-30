package com.nunes.callcollector

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch

class PhoneStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        val prefs = context.getSharedPreferences("nunes_phone_state", Context.MODE_PRIVATE)
        val previous = prefs.getString("last_state", "") ?: ""
        prefs.edit().putString("last_state", state).apply()

        val callHadActivity =
            previous == TelephonyManager.EXTRA_STATE_RINGING ||
            previous == TelephonyManager.EXTRA_STATE_OFFHOOK

        val phoneNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
        val direction = if (previous == TelephonyManager.EXTRA_STATE_RINGING) "INCOMING" else "OUTGOING"

        if (state == TelephonyManager.EXTRA_STATE_OFFHOOK) {
            val startIntent = Intent(context, CallRecordingService::class.java).apply {
                action = CallRecordingService.ACTION_START
                putExtra("PHONE_NUMBER", phoneNumber)
                putExtra("DIRECTION", direction)
            }
            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    context.startForegroundService(startIntent)
                } else {
                    context.startService(startIntent)
                }
            } catch (e: Exception) {
                e.printStackTrace()
                val pendingResult = goAsync()
                GlobalScope.launch(Dispatchers.IO) {
                    try {
                        val entity = com.nunes.callcollector.data.RecordingEntity(
                            sourceCallId = null,
                            sha256 = null,
                            filePath = null,
                            fileSizeBytes = 0,
                            durationMs = 0,
                            recordingSource = "OS_BLOCKED",
                            audioScope = "NONE",
                            capability = "NONE",
                            employeeNoticeStatus = "NOT_CAPTURED",
                            customerConsentStatus = "UNKNOWN",
                            consentBasis = "NOT_RECORDED",
                            startedAtEpochMs = System.currentTimeMillis(),
                            endedAtEpochMs = System.currentTimeMillis(),
                            uploadStatus = "FAILED_BLOCKED_BY_OS",
                            phoneNumber = phoneNumber,
                            direction = direction
                        )
                        com.nunes.callcollector.data.AppDatabase.get(context).recordingDao().insert(entity)
                        com.nunes.callcollector.AutomationScheduler.enqueueSync(context)
                    } finally {
                        pendingResult.finish()
                    }
                }
            }
        }

        if (state == TelephonyManager.EXTRA_STATE_IDLE && callHadActivity) {
            val stopIntent = Intent(context, CallRecordingService::class.java).apply {
                action = CallRecordingService.ACTION_STOP
            }
            try {
                context.startService(stopIntent)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            AutomationScheduler.enqueueCapture(context, delaySeconds = 3L)
            AutomationScheduler.enqueueCapture(context, delaySeconds = 20L)
            AutomationScheduler.enqueueHealth(context, eventType = "CALL_FINISHED", delaySeconds = 6L)
        }
    }
}
