package com.nunes.callcollector.control

import com.nunes.callcollector.ConfigStore

data class MarketingRecipient(
    val employeeId: String,
    val employeeName: String,
    val phoneNumber: String,
    val available: Boolean
)

object ShaneMarketingApi {
    fun load(config: ConfigStore): List<MarketingRecipient> {
        val response = DeviceApi.request(
            config,
            DeviceApi.devicePath(config) + "/shane/marketing-recipients"
        )
        val rows = response.optJSONArray("employees") ?: return emptyList()
        return buildList {
            for (index in 0 until rows.length()) {
                val row = rows.optJSONObject(index) ?: continue
                val employeeId = row.optString("employee_id", "").trim()
                val employeeName = row.optString("employee_name", "").trim()
                val phoneNumber = row.optString("phone_number", "").trim()
                if (employeeId.isBlank() || employeeName.isBlank()) continue
                add(
                    MarketingRecipient(
                        employeeId = employeeId,
                        employeeName = employeeName,
                        phoneNumber = phoneNumber,
                        available = row.optBoolean("available", phoneNumber.isNotBlank())
                    )
                )
            }
        }
    }
}
