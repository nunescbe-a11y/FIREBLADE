package com.nunes.callcollector.callbacks

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat
import com.nunes.callcollector.MainActivity
import com.nunes.callcollector.R

object FollowUpNotifier {
    private const val CHANNEL_ID = "fireblade_followups"
    private const val GROUP_KEY = "fireblade_callback_group"
    private const val SUMMARY_ID = 4099

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Customer callback reminders",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Reminders for missed customer calls that still need a successful callback"
            }
            manager?.createNotificationChannel(channel)
        }
    }

    fun notificationsAllowed(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    fun sync(context: Context, previousKeys: Set<String>, summary: CallbackSummary) {
        ensureChannel(context)
        val manager = NotificationManagerCompat.from(context)
        val activeKeys = summary.pending.map { it.key }.toSet()

        (previousKeys - activeKeys).forEach { key ->
            manager.cancel(notificationId(key))
            CallbackSnapshotStore.clearNotificationStep(context, key)
        }

        if (!notificationsAllowed(context)) {
            if (summary.pending.size < 2) manager.cancel(SUMMARY_ID)
            return
        }

        val now = System.currentTimeMillis()
        var dueCount = 0

        summary.pending.forEach { task ->
            val step = reminderStep(now - task.firstMissAt)
            val previous = CallbackSnapshotStore.notificationStep(context, task.key)
            if (step > 0 && step > previous) {
                dueCount++
                notifyTask(context, task, now)
                CallbackSnapshotStore.setNotificationStep(context, task.key, step)
            }
        }

        val overdue = summary.pending.count { now - it.firstMissAt >= 2L * 60L * 60L * 1000L }
        if (summary.pending.size >= 2 && (dueCount > 0 || overdue > 0)) {
            val text = buildString {
                append("${summary.pending.size} callbacks still pending")
                if (overdue > 0) append(" • $overdue overdue")
            }
            val open = PendingIntent.getActivity(
                context,
                9001,
                Intent(context, MainActivity::class.java).putExtra("open_callbacks", true),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            manager.notify(
                SUMMARY_ID,
                NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notification_fireblade)
                    .setContentTitle("Fireblade follow-up")
                    .setContentText(text)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                    .setContentIntent(open)
                    .setAutoCancel(true)
                    .setGroup(GROUP_KEY)
                    .setGroupSummary(true)
                    .setCategory(NotificationCompat.CATEGORY_REMINDER)
                    .build()
            )
        } else {
            manager.cancel(SUMMARY_ID)
        }
    }

    private fun notifyTask(context: Context, task: CallbackTask, now: Long) {
        val manager = NotificationManagerCompat.from(context)
        val label = task.contactName?.takeIf { it.isNotBlank() } ?: task.numberRaw.ifBlank { task.numberNormalized }
        val age = CallbackEngine.ageText(task.firstMissAt, now)

        val open = PendingIntent.getActivity(
            context,
            notificationId(task.key),
            Intent(context, MainActivity::class.java)
                .putExtra("focus_number", task.key)
                .putExtra("open_callbacks", true),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val dialNumber = task.numberRaw.ifBlank { task.numberNormalized }
        val callBack = PendingIntent.getActivity(
            context,
            notificationId(task.key) + 100000,
            Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", dialNumber, null)),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val detail = if (task.latestAttemptAt != null) {
            "$label is still waiting. You tried calling back, but the call was not connected."
        } else {
            "$label has been waiting $age for a callback."
        }

        manager.notify(
            notificationId(task.key),
            NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification_fireblade)
                .setContentTitle(if (now - task.firstMissAt >= 2L * 60L * 60L * 1000L) "Callback overdue" else "Callback required")
                .setContentText(detail)
                .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
                .setContentIntent(open)
                .addAction(0, if (task.latestAttemptAt != null) "Call again" else "Call back", callBack)
                .addAction(0, "View", open)
                .setAutoCancel(true)
                .setGroup(GROUP_KEY)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()
        )
    }

    private fun reminderStep(ageMs: Long): Int {
        val minutes = ageMs.coerceAtLeast(0L) / 60_000L
        return when {
            minutes < 30 -> 0
            minutes < 60 -> 1
            minutes < 120 -> 2
            else -> 3 + ((minutes - 120) / 120).toInt()
        }
    }

    private fun notificationId(key: String): Int =
        10_000 + (key.hashCode() and 0x7fffffff) % 80_000
}
