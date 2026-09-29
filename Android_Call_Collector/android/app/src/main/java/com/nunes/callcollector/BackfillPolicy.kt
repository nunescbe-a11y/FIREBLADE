package com.nunes.callcollector

/**
 * Fireblade production rollout window.
 *
 * Historical call-log import starts at 01-Aug-2026 00:00:00 India time.
 * After that point, the normal post-call receiver + WorkManager flow keeps
 * collecting and uploading new calls continuously.
 */
object BackfillPolicy {
    const val START_EPOCH_MS: Long = 1785522600000L
    const val START_LABEL: String = "01-Aug-2026"
}
