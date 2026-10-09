package com.nunes.callcollector

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

enum class PremiumTab { HOME, ASSIGNED, HISTORY, CALLBACKS, PROFILE }

object PremiumNav {
    private data class NavItem(
        val tab: PremiumTab,
        val container: Int,
        val icon: Int,
        val label: Int,
        val target: Class<out Activity>
    )

    fun bind(activity: AppCompatActivity, root: View, active: PremiumTab) {
        val items = listOf(
            NavItem(PremiumTab.HOME, R.id.navHome, R.id.navHomeIcon, R.id.navHomeLabel, EmployeeHomeActivity::class.java),
            NavItem(PremiumTab.ASSIGNED, R.id.navAssigned, R.id.navAssignedIcon, R.id.navAssignedLabel, AssignedCustomersActivity::class.java),
            NavItem(PremiumTab.HISTORY, R.id.navHistory, R.id.navHistoryIcon, R.id.navHistoryLabel, HistoryActivity::class.java),
            NavItem(PremiumTab.CALLBACKS, R.id.navCallbacks, R.id.navCallbacksIcon, R.id.navCallbacksLabel, CallbacksActivity::class.java),
            NavItem(PremiumTab.PROFILE, R.id.navProfile, R.id.navProfileIcon, R.id.navProfileLabel, ProfileActivity::class.java)
        )

        val activeColor = Color.parseColor("#174EA6")
        val inactiveColor = Color.parseColor("#7E7A73")

        items.forEach { item ->
            val selected = item.tab == active
            root.findViewById<ImageView>(item.icon)?.setColorFilter(if (selected) activeColor else inactiveColor)
            root.findViewById<TextView>(item.label)?.setTextColor(if (selected) activeColor else inactiveColor)
            root.findViewById<View>(item.container)?.apply {
                isSelected = selected
                setOnClickListener {
                    if (!selected) {
                        activity.startActivity(
                            Intent(activity, item.target)
                                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        )
                        activity.overridePendingTransition(0, 0)
                    }
                }
            }
        }
    }
}
