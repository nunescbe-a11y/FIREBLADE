package com.nunes.callcollector

import kotlinx.coroutines.launch
import android.app.Application
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

class CollectorApplication : Application() {
    private var mobileDataCallback: TelephonyCallback? = null

    override fun onCreate() {
        super.onCreate()
        com.nunes.callcollector.control.UpdateWorker.schedule(this)
        com.nunes.callcollector.callbacks.FollowUpNotifier.ensureChannel(this)
        com.nunes.callcollector.callbacks.CallbackRefreshWorker.enqueue(this)
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
            try { com.nunes.callcollector.control.ManagedConfiguration.apply(this@CollectorApplication) } catch (_: Exception) { }
        }
        try {
            if (com.google.firebase.FirebaseApp.getApps(this).isNotEmpty()) {
                com.google.firebase.messaging.FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                    ConfigStore(this).pushToken = token
                    com.nunes.callcollector.control.CommandWorker.enqueue(this)
                }
            }
        } catch (_: Exception) { }

        AutomationScheduler.schedulePeriodicReconciliation(this)
        AutomationScheduler.scheduleNextHealthPulse(this)

        try {
            ContextCompat.registerReceiver(
                this,
                ShutdownReceiver(),
                IntentFilter(Intent.ACTION_SHUTDOWN),
                ContextCompat.RECEIVER_EXPORTED
            )
        } catch (_: Exception) {
            // Shutdown confirmation is best-effort only.
        }

        try {
            val cm = getSystemService(ConnectivityManager::class.java)
            cm?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    AutomationScheduler.enqueueHealth(this@CollectorApplication, eventType = "NETWORK_AVAILABLE", delaySeconds = 1L)
                }

                override fun onLost(network: Network) {
                    AutomationScheduler.enqueueHealth(this@CollectorApplication, eventType = "NETWORK_LOST", delaySeconds = 1L)
                }

                override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
                    AutomationScheduler.enqueueHealth(this@CollectorApplication, eventType = "NETWORK_CHANGE", delaySeconds = 1L)
                }
            })
        } catch (_: Exception) {
            // WorkManager health pulses remain the fallback.
        }

        // Android 12+ offers a callback specifically for the user's Mobile Data
        // toggle. This gives quicker ON/OFF updates than waiting for the next pulse.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                val tm = getSystemService(TelephonyManager::class.java)
                val callback = object : TelephonyCallback(), TelephonyCallback.UserMobileDataStateListener {
                    override fun onUserMobileDataStateChanged(enabled: Boolean) {
                        AutomationScheduler.enqueueHealth(
                            this@CollectorApplication,
                            eventType = if (enabled) "MOBILE_DATA_ON" else "MOBILE_DATA_OFF",
                            delaySeconds = 1L
                        )
                    }
                }
                tm?.registerTelephonyCallback(mainExecutor, callback)
                mobileDataCallback = callback
            } catch (_: Exception) {
                // Android 8-11 and restrictive OEM builds use the heartbeat polling fallback.
            }
        }
    }
}
