package com.nunes.callcollector.control

/**
 * Side-effect-free decisions shared by the Android updater and its unit tests.
 * The installed PackageManager version, never a cached preference, is authoritative.
 */
internal object UpdateDecision {
    private const val PROMPT_COOLDOWN_MS = 15L * 60L * 1000L

    fun needsUpdate(installedVersionCode: Long, releaseVersionCode: Long): Boolean =
        releaseVersionCode > installedVersionCode

    fun shouldShowPrompt(
        releaseId: String,
        previousReleaseId: String,
        previousPromptAt: Long,
        now: Long
    ): Boolean {
        if (releaseId.isBlank()) return false
        if (releaseId != previousReleaseId) return true
        // Reset a bad/future clock instead of suppressing updates indefinitely.
        if (previousPromptAt <= 0L || now < previousPromptAt) return true
        return now - previousPromptAt >= PROMPT_COOLDOWN_MS
    }
}
