package com.nunes.callcollector.control
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.*
import com.nunes.callcollector.ConfigStore
import com.nunes.callcollector.MainActivity
import com.nunes.callcollector.R
import com.nunes.callcollector.health.HealthReporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
class CommandWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val config = ConfigStore(applicationContext)
        if (config.deviceToken.isBlank() || config.deviceId.isBlank()) return@withContext Result.success()
        try {
            drain(applicationContext, inputData.getString("request_id"))
            Result.success()
        } catch (e: DeviceHttpError) {
            if (e.status in listOf(401,403,404,409)) Result.success() else if (runAttemptCount < 2) Result.retry() else Result.failure()
        } catch (_: Exception) { if (runAttemptCount < 2) Result.retry() else Result.failure() }
    }
    override suspend fun getForegroundInfo(): ForegroundInfo {
        val nm = applicationContext.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("fireblade_status", "Device checks", NotificationManager.IMPORTANCE_LOW))
        val intent = PendingIntent.getActivity(applicationContext,0,Intent(applicationContext,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(applicationContext,"fireblade_status").setSmallIcon(R.drawable.fireblade_mark).setContentTitle("Fireblade App").setContentText("Checking this company phone").setContentIntent(intent).setOngoing(true).build()
        return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(37, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(37,notification)
    }
    companion object {
        fun enqueue(context: Context, requestId: String? = null) {
            val builder=OneTimeWorkRequestBuilder<CommandWorker>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            if (requestId != null) builder.setInputData(Data.Builder().putString("request_id",requestId).build()).setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            WorkManager.getInstance(context).enqueueUniqueWork("fireblade-command-${requestId ?: "poll"}",ExistingWorkPolicy.KEEP,builder.build())
        }
        suspend fun drain(context: Context, requestedId: String? = null) {
            val config=ConfigStore(context)
            if (config.deviceToken.isBlank()) return
            // FCM is a wake-up hint. Only authenticated server-issued, unexpired commands are used.
            val path=DeviceApi.devicePath(config)
            val commands=DeviceApi.request(config,"$path/commands").optJSONArray("commands") ?: return
            for (i in 0 until commands.length()) {
                val row=commands.getJSONObject(i); val id=row.getString("request_id")
                if (requestedId != null && requestedId != id) continue
                val snapshot=HealthReporter.collect(context,"MANUAL_CHECK",config)
                try { DeviceApi.request(config,"$path/checks/$id",snapshot) }
                catch (e: DeviceHttpError) { if (e.status != 409) throw e }
            }
            // Token failure must never prevent the status snapshot itself from being returned.
            if(config.pushToken.isNotBlank()) try { DeviceApi.request(config,"$path/push-token",JSONObject().put("token",config.pushToken)) } catch (_:Exception) { }
        }
    }
}
