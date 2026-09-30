package com.nunes.callcollector

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.data.RecordingEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.io.File
import java.security.MessageDigest

class CallRecordingService : Service() {
    private var mediaRecorder: MediaRecorder? = null
    private var isRecording = false
    private var currentFile: File? = null
    private var currentSourceCallId: String? = null
    private var phoneNumber: String? = null
    private var direction: String? = null
    private var recordingSource: String = "MEDIARECORDER_MIC"
    private var audioScope: String = "EMPLOYEE_ONLY"
    private var capability: String = "MIC_ONLY"
    private var startTimeMs: Long = 0
    private val serviceJob = Job()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)

    companion object {
        const val ACTION_START = "ACTION_START_RECORDING"
        const val ACTION_STOP = "ACTION_STOP_RECORDING"
        const val EXTRA_SOURCE_CALL_ID = "EXTRA_SOURCE_CALL_ID"
        const val CHANNEL_ID = "call_recording_channel"
        const val NOTIFICATION_ID = 1001
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_START) {
            phoneNumber = intent.getStringExtra("PHONE_NUMBER")
            direction = intent.getStringExtra("DIRECTION")
            startRecording()
        } else if (intent?.action == ACTION_STOP) {
            stopRecording()
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Call Recording",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when a call is being recorded"
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun getNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Call Recording Active")
            .setContentText("Recording in progress...")
            .setSmallIcon(R.drawable.ic_notification_fireblade)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun startRecording() {
        if (isRecording) return

        startTimeMs = System.currentTimeMillis()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID, 
                    getNotification(), 
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                )
            } else {
                startForeground(NOTIFICATION_ID, getNotification())
            }
        } catch (e: Exception) {
            // Foreground service start restrictions on Android 12+
            e.printStackTrace()
            recordBlockedByOs()
            stopSelf()
            return
        }

        val recordingsDir = File(filesDir, "recordings").apply { mkdirs() }
        currentFile = File(recordingsDir, "rec_${System.currentTimeMillis()}.mp4")

        mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(this)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }

        try {
            // Attempt VOICE_CALL first
            mediaRecorder?.setAudioSource(MediaRecorder.AudioSource.VOICE_CALL)
            mediaRecorder?.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            mediaRecorder?.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            mediaRecorder?.setOutputFile(currentFile?.absolutePath)
            mediaRecorder?.prepare()
            mediaRecorder?.start()
            recordingSource = "MEDIARECORDER_VOICE_CALL"
            audioScope = "BOTH_SIDES_CANDIDATE"
            capability = "VOICE_CALL"
            isRecording = true
            startTimeMs = System.currentTimeMillis()
        } catch (e: Exception) {
            // Fallback to MIC
            mediaRecorder?.reset()
            try {
                mediaRecorder?.setAudioSource(MediaRecorder.AudioSource.MIC)
                mediaRecorder?.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                mediaRecorder?.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                mediaRecorder?.setOutputFile(currentFile?.absolutePath)
                mediaRecorder?.prepare()
                mediaRecorder?.start()
                recordingSource = "MEDIARECORDER_MIC"
                audioScope = "EMPLOYEE_ONLY"
                capability = "MIC_ONLY"
                isRecording = true
                startTimeMs = System.currentTimeMillis()
            } catch (e2: Exception) {
                e2.printStackTrace()
                recordUnsupported()
                stopSelf()
                return
            }
        }
    }

    private fun stopRecording() {
        if (!isRecording) return
        val endTimeMs = System.currentTimeMillis()
        try {
            mediaRecorder?.apply {
                stop()
                release()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        isRecording = false
        mediaRecorder = null

        val duration = endTimeMs - startTimeMs
        val file = currentFile

        if (file != null && file.exists()) {
            serviceScope.launch {
                val sha256 = calculateSha256(file)
                val entity = RecordingEntity(
                    sourceCallId = null,
                    sha256 = sha256,
                    filePath = file.absolutePath,
                    fileSizeBytes = file.length(),
                    durationMs = duration,
                    recordingSource = recordingSource,
                    audioScope = audioScope,
                    capability = capability,
                    employeeNoticeStatus = "NOT_CAPTURED",
                    customerConsentStatus = "UNKNOWN",
                    consentBasis = "NOT_RECORDED",
                    startedAtEpochMs = startTimeMs,
                    endedAtEpochMs = endTimeMs,
                    uploadStatus = "PENDING",
                    phoneNumber = phoneNumber,
                    direction = direction
                )
                AppDatabase.get(applicationContext).recordingDao().insert(entity)
                
                // Enqueue upload
                com.nunes.callcollector.AutomationScheduler.enqueueSync(applicationContext)
            }
        } else {
            cleanup()
        }
    }

    private fun recordBlockedByOs() {
        serviceScope.launch {
            val entity = RecordingEntity(
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
                startedAtEpochMs = startTimeMs,
                endedAtEpochMs = startTimeMs,
                uploadStatus = "FAILED_BLOCKED_BY_OS",
                phoneNumber = phoneNumber,
                direction = direction
            )
            AppDatabase.get(applicationContext).recordingDao().insert(entity)
        }
    }

    private fun recordUnsupported() {
        serviceScope.launch {
            val entity = RecordingEntity(
                sourceCallId = null,
                sha256 = null,
                filePath = null,
                fileSizeBytes = 0,
                durationMs = 0,
                recordingSource = "UNSUPPORTED",
                audioScope = "NONE",
                capability = "NONE",
                employeeNoticeStatus = "NOT_CAPTURED",
                customerConsentStatus = "UNKNOWN",
                consentBasis = "NOT_RECORDED",
                startedAtEpochMs = startTimeMs,
                endedAtEpochMs = startTimeMs,
                uploadStatus = "FAILED_UNSUPPORTED",
                phoneNumber = phoneNumber,
                direction = direction
            )
            AppDatabase.get(applicationContext).recordingDao().insert(entity)
        }
    }

    private fun calculateSha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            var bytesRead: Int
            while (input.read(buffer).also { bytesRead = it } != -1) {
                md.update(buffer, 0, bytesRead)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun cleanup() {
        currentFile?.let {
            if (it.exists()) it.delete()
        }
        currentFile = null
    }

    override fun onDestroy() {
        stopRecording()
        serviceJob.cancel()
        super.onDestroy()
    }
}
