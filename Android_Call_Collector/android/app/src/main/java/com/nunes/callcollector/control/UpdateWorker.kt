package com.nunes.callcollector.control
import android.content.Context
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit
class UpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context,params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try { AppUpdater.checkAndDownload(applicationContext); Result.success() }
        catch (_:Exception) { if(runAttemptCount<2)Result.retry() else Result.failure() }
    }
    companion object {
        fun schedule(context: Context) {
            val constraints=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("fireblade-updates",ExistingPeriodicWorkPolicy.KEEP,PeriodicWorkRequestBuilder<UpdateWorker>(1,TimeUnit.HOURS).setConstraints(constraints).build())
        }
        fun now(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork("fireblade-update-now",ExistingWorkPolicy.KEEP,OneTimeWorkRequestBuilder<UpdateWorker>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        }
    }
}
