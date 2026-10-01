package com.nunes.callcollector

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val openCallbacks = intent.getBooleanExtra("open_callbacks", false)
        val focus = intent.getStringExtra("focus_number")
        val selectedDay = intent.getLongExtra(
            "selected_day_start",
            DateSelectionStore(this).selectedDayStart()
        )

        val target = if (openCallbacks || !focus.isNullOrBlank()) {
            Intent(this, CallbacksActivity::class.java)
                .putExtra("selected_day_start", selectedDay)
                .putExtra("focus_number", focus)
        } else {
            Intent(this, EmployeeHomeActivity::class.java)
                .putExtra("selected_day_start", selectedDay)
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
