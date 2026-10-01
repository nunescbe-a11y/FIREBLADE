package com.nunes.callcollector.callbacks

data class CallbackTask(
    val key: String,
    val numberRaw: String,
    val numberNormalized: String,
    val contactName: String?,
    val firstMissAt: Long,
    val latestMissAt: Long,
    val missedCount: Int,
    val latestAttemptAt: Long?,
    val ringSeconds: Long,
    val simSlotIndex: Int?
) {
    val displayName: String
        get() = contactName?.takeIf { it.isNotBlank() } ?: numberRaw.ifBlank { numberNormalized }
}

data class CallbackSummary(
    val pending: List<CallbackTask>,
    val resolvedToday: Int,
    val generatedAt: Long = System.currentTimeMillis(),
    val totalIncomingCount: Int = 0,
    val answeredCount: Int = 0,
    val missedCount: Int = 0,
    val selectedDayStart: Long = 0L
) {
    val pendingCount: Int get() = pending.size
    val overdueCount: Int
        get() = pending.count { generatedAt - it.firstMissAt >= 2L * 60L * 60L * 1000L }
}
