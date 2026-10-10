package com.nunes.callcollector

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (
            intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            // After a successful APK replacement, clear any old update prompt,
            // downloaded APK, and notification before workers or screens run.
            com.nunes.callcollector.control.AppUpdater.reconcileInstalledState(context)
            com.nunes.callcollector.control.UpdateWorker.schedule(context)
            com.nunes.callcollector.control.UpdateWorker.now(context)
            com.nunes.callcollector.control.CommandWorker.enqueue(context)
            AutomationScheduler.schedulePeriodicReconciliation(context)
            AutomationScheduler.enqueueCapture(context, delaySeconds = 5L)
            AutomationScheduler.enqueueHealth(
                context,
                eventType = if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) "PACKAGE_REPLACED" else "BOOT",
                delaySeconds = 10L
            )
            AutomationScheduler.scheduleNextHealthPulse(context)
            com.nunes.callcollector.callbacks.CallbackRefreshWorker.schedule(context)
            com.nunes.callcollector.callbacks.CallbackRefreshWorker.enqueue(context)
        }
    }
}
