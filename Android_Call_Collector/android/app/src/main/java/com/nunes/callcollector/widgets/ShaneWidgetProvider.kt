package com.nunes.callcollector.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.widget.RemoteViews
import com.nunes.callcollector.MainActivity
import com.nunes.callcollector.R
import com.nunes.callcollector.ShaneMode
import com.nunes.callcollector.data.AppDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class ShaneAddDetailsWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { manager.updateAppWidget(it, ShaneWidgetUpdater.addDetailsViews(context)) }
    }
}

class ShaneOpenHistoryWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { manager.updateAppWidget(it, ShaneWidgetUpdater.openHistoryViews(context)) }
    }
}

class ShaneMissedCallsWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { manager.updateAppWidget(it, ShaneWidgetUpdater.missedCallsViews(context, null)) }
        ShaneWidgetUpdater.updateMissedCount(context)
    }
}

object ShaneWidgetUpdater {
    private val scope = CoroutineScope(Dispatchers.IO)

    fun updateAll(context: Context) {
        if (!ShaneMode.isEnabled(context)) return
        val manager = AppWidgetManager.getInstance(context)

        manager.getAppWidgetIds(
            ComponentName(context, ShaneAddDetailsWidgetProvider::class.java)
        ).forEach { manager.updateAppWidget(it, addDetailsViews(context)) }

        manager.getAppWidgetIds(
            ComponentName(context, ShaneOpenHistoryWidgetProvider::class.java)
        ).forEach { manager.updateAppWidget(it, openHistoryViews(context)) }

        updateMissedCount(context)
    }

    fun addDetailsViews(context: Context): RemoteViews =
        RemoteViews(context.packageName, R.layout.widget_shane_add_details).apply {
            setOnClickPendingIntent(R.id.widgetShaneAddRoot, openShaneLatest(context, 7601))
        }

    fun openHistoryViews(context: Context): RemoteViews =
        RemoteViews(context.packageName, R.layout.widget_shane_open_history).apply {
            setOnClickPendingIntent(R.id.widgetShaneHistoryRoot, openHistory(context, 7602))
        }

    fun missedCallsViews(context: Context, count: Int?): RemoteViews =
        RemoteViews(context.packageName, R.layout.widget_shane_missed_calls).apply {
            setTextViewText(R.id.widgetShaneMissedCount, count?.toString() ?: "—")
            setOnClickPendingIntent(R.id.widgetShaneMissedRoot, openHistory(context, 7603))
        }

    fun updateMissedCount(context: Context) {
        val appContext = context.applicationContext
        scope.launch {
            val count = try {
                AppDatabase.get(appContext).callDao().missedCount()
            } catch (_: Exception) {
                null
            }
            val manager = AppWidgetManager.getInstance(appContext)
            val ids = manager.getAppWidgetIds(
                ComponentName(appContext, ShaneMissedCallsWidgetProvider::class.java)
            )
            ids.forEach { manager.updateAppWidget(it, missedCallsViews(appContext, count)) }
        }
    }

    private fun openShaneLatest(context: Context, requestCode: Int) = PendingIntent.getActivity(
        context,
        requestCode,
        Intent(context, MainActivity::class.java).putExtra("open_shane_latest", true),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun openHistory(context: Context, requestCode: Int) = PendingIntent.getActivity(
        context,
        requestCode,
        Intent(context, MainActivity::class.java).putExtra("open_history", true),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
}

object WidgetModeCoordinator {
    fun sync(context: Context) {
        val appContext = context.applicationContext
        val shane = ShaneMode.isEnabled(appContext)
        val pm = appContext.packageManager

        setEnabled(pm, ComponentName(appContext, CallbackWidgetProvider::class.java), !shane)
        setEnabled(pm, ComponentName(appContext, CallbackCompactWidgetProvider::class.java), !shane)
        setEnabled(pm, ComponentName(appContext, ShaneAddDetailsWidgetProvider::class.java), shane)
        setEnabled(pm, ComponentName(appContext, ShaneOpenHistoryWidgetProvider::class.java), shane)
        setEnabled(pm, ComponentName(appContext, ShaneMissedCallsWidgetProvider::class.java), shane)

        if (shane) ShaneWidgetUpdater.updateAll(appContext)
    }

    private fun setEnabled(pm: PackageManager, component: ComponentName, enabled: Boolean) {
        val desired = if (enabled) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        } else {
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        }
        if (pm.getComponentEnabledSetting(component) != desired) {
            pm.setComponentEnabledSetting(component, desired, PackageManager.DONT_KILL_APP)
        }
    }
}
