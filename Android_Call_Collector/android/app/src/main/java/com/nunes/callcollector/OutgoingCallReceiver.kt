package com.nunes.callcollector

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

@Suppress("DEPRECATION")
class OutgoingCallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "android.intent.action.NEW_OUTGOING_CALL") return
        val number = intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER)
        LiveCallStore.onOutgoingNumber(context, number)
        try {
            com.nunes.callcollector.widgets.CallbackWidgetUpdater.updateAll(context)
        } catch (_: Exception) { }
    }
}
