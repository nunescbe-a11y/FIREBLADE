package com.nunes.callcollector.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import com.nunes.callcollector.FirebladeDatePolicy
import com.nunes.callcollector.MainActivity
import com.nunes.callcollector.R
import com.nunes.callcollector.ShaneMode
import com.nunes.callcollector.callbacks.CallbackEngine
import com.nunes.callcollector.callbacks.CallbackSnapshotStore

class CallbackWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { manager.updateAppWidget(it, CallbackWidgetUpdater.largeViews(context)) }
    }

    override fun onEnabled(context: Context) {
        com.nunes.callcollector.callbacks.CallbackRefreshWorker.enqueue(context)
    }
}

class CallbackCompactWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { manager.updateAppWidget(it, CallbackWidgetUpdater.compactViews(context)) }
    }

    override fun onEnabled(context: Context) {
        com.nunes.callcollector.callbacks.CallbackRefreshWorker.enqueue(context)
    }
}

object CallbackWidgetUpdater {
    fun updateAll(context: Context) {
        if (ShaneMode.isEnabled(context)) {
            ShaneWidgetUpdater.updateAll(context)
        }

        val manager = AppWidgetManager.getInstance(context)
        val large = manager.getAppWidgetIds(ComponentName(context, CallbackWidgetProvider::class.java))
        large.forEach { manager.updateAppWidget(it, largeViews(context)) }
        val compact = manager.getAppWidgetIds(ComponentName(context, CallbackCompactWidgetProvider::class.java))
        compact.forEach { manager.updateAppWidget(it, compactViews(context)) }
    }

    fun largeViews(context: Context): RemoteViews {
        val snapshot = CallbackSnapshotStore.read(context)
        val views = RemoteViews(context.packageName, R.layout.widget_callbacks)

        if (ShaneMode.isEnabled(context)) {
            views.setViewVisibility(R.id.widgetOpen, View.GONE)
            views.setViewVisibility(R.id.widgetCount, View.GONE)
            views.setViewVisibility(R.id.widgetSubtitle, View.GONE)
            views.setViewVisibility(R.id.widgetRow1, View.GONE)
            views.setViewVisibility(R.id.widgetRow2, View.GONE)
            views.setViewVisibility(R.id.widgetRow3, View.GONE)
            views.setViewVisibility(R.id.widgetUpdated, View.GONE)
            views.setViewVisibility(R.id.widgetShaneActions, View.VISIBLE)
            views.setOnClickPendingIntent(R.id.widgetAddDetails, openShaneLatest(context, 7401))
            views.setOnClickPendingIntent(R.id.widgetOpenPage, openHistory(context, 7402))
            views.setOnClickPendingIntent(R.id.widgetRoot, openHistory(context, 7403))
            return views
        }

        views.setViewVisibility(R.id.widgetShaneActions, View.GONE)
        views.setViewVisibility(R.id.widgetOpen, View.VISIBLE)
        views.setViewVisibility(R.id.widgetCount, View.VISIBLE)
        views.setViewVisibility(R.id.widgetSubtitle, View.VISIBLE)
        views.setViewVisibility(R.id.widgetUpdated, View.VISIBLE)
        views.setTextViewText(R.id.widgetCount, snapshot.pendingCount.toString())
        views.setTextViewText(
            R.id.widgetSubtitle,
            when {
                snapshot.pendingCount == 0 -> "All caught up"
                snapshot.overdueCount > 0 -> "${snapshot.overdueCount} overdue"
                else -> "Callback${if (snapshot.pendingCount == 1) "" else "s"} required"
            }
        )

        val rows = listOf(
            Triple(R.id.widgetRow1, R.id.widgetName1, R.id.widgetAge1),
            Triple(R.id.widgetRow2, R.id.widgetName2, R.id.widgetAge2),
            Triple(R.id.widgetRow3, R.id.widgetName3, R.id.widgetAge3)
        )
        rows.forEachIndexed { index, (rowId, nameId, ageId) ->
            val task = snapshot.pending.getOrNull(index)
            if (task == null) {
                views.setViewVisibility(rowId, View.GONE)
            } else {
                views.setViewVisibility(rowId, View.VISIBLE)
                views.setTextViewText(nameId, task.displayName)
                views.setTextViewText(ageId, CallbackEngine.ageText(task.firstMissAt))
            }
        }

        val updated = CallbackSnapshotStore.updatedAt(context)
        views.setTextViewText(
            R.id.widgetUpdated,
            if (updated > 0) "Updated ${FirebladeDatePolicy.displayTime(updated)}" else "Open Fireblade to refresh"
        )
        views.setOnClickPendingIntent(R.id.widgetRoot, openApp(context, 7201))
        views.setOnClickPendingIntent(R.id.widgetOpen, openApp(context, 7202))
        return views
    }

    fun compactViews(context: Context): RemoteViews {
        val snapshot = CallbackSnapshotStore.read(context)
        val views = RemoteViews(context.packageName, R.layout.widget_callbacks_compact)

        if (ShaneMode.isEnabled(context)) {
            views.setViewVisibility(R.id.widgetCompactCount, View.GONE)
            views.setViewVisibility(R.id.widgetCompactLabel, View.GONE)
            views.setViewVisibility(R.id.widgetCompactActions, View.VISIBLE)
            views.setOnClickPendingIntent(R.id.widgetCompactAddDetails, openShaneLatest(context, 7501))
            views.setOnClickPendingIntent(R.id.widgetCompactOpenPage, openHistory(context, 7502))
            views.setOnClickPendingIntent(R.id.widgetCompactRoot, openHistory(context, 7503))
            return views
        }

        views.setViewVisibility(R.id.widgetCompactActions, View.GONE)
        views.setViewVisibility(R.id.widgetCompactCount, View.VISIBLE)
        views.setViewVisibility(R.id.widgetCompactLabel, View.VISIBLE)
        views.setTextViewText(R.id.widgetCompactCount, snapshot.pendingCount.toString())
        views.setTextViewText(
            R.id.widgetCompactLabel,
            if (snapshot.pendingCount == 0) "All caught up"
            else if (snapshot.overdueCount > 0) "${snapshot.overdueCount} overdue"
            else "Callback required"
        )
        views.setOnClickPendingIntent(R.id.widgetCompactRoot, openApp(context, 7301))
        return views
    }

    private fun openApp(context: Context, requestCode: Int) = PendingIntent.getActivity(
        context,
        requestCode,
        Intent(context, MainActivity::class.java).putExtra("open_callbacks", true),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

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
