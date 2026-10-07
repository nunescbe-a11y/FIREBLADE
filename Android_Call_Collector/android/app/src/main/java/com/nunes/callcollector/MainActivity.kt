package com.nunes.callcollector

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val openCallbacks = intent.getBooleanExtra("open_callbacks", false)
        val openHistory = intent.getBooleanExtra("open_history", false)
        val openShaneLatest = intent.getBooleanExtra("open_shane_latest", false)
        val openDetail = openShaneLatest ||
            intent.hasExtra(ShaneCallDetailActivity.EXTRA_PHONE_RAW) ||
            intent.hasExtra(ShaneCallDetailActivity.EXTRA_PHONE_NORMALIZED) ||
            intent.hasExtra(ShaneCallDetailActivity.EXTRA_SOURCE_CALL_ID)
        val focus = intent.getStringExtra("focus_number")
        val selectedDay = intent.getLongExtra(
            "selected_day_start",
            DateSelectionStore(this).selectedDayStart()
        )

        val target = when {
            openDetail -> {
                Intent(this, ShaneCallDetailActivity::class.java).apply {
                    putExtras(intent)
                    if (openShaneLatest) {
                        putExtra(ShaneCallDetailActivity.EXTRA_OPEN_LATEST_SPOKEN, true)
                    }
                }
            }
            openHistory -> {
                Intent(this, HistoryActivity::class.java)
                    .putExtra("selected_day_start", selectedDay)
            }
            openCallbacks || !focus.isNullOrBlank() -> {
                Intent(this, CallbacksActivity::class.java)
                    .putExtra("selected_day_start", selectedDay)
                    .putExtra("focus_number", focus)
            }
            else -> {
                Intent(this, EmployeeHomeActivity::class.java)
                    .putExtra("selected_day_start", selectedDay)
            }
        }

        startActivity(target)
        finish()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        recreate()
    }
}
