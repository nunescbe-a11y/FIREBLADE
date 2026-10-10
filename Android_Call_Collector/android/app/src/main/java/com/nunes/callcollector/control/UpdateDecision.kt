package com.nunes.callcollector.control

/**
 * PackageManager's installed version is authoritative. A new release may be
 * offered once for each installed-version/release pair; repeatedly reopening
 * Fireblade must never reopen the same installer prompt.
 *
 * A declined/cancelled update remains accessible from Advanced Admin and
 * the download-ready notification, without nagging on every app launch.
 */
internal object UpdateDecision {
    fun needsUpdate(installedVersionCode: Long, releaseVersionCode: Long): Boolean =
        releaseVersionCode > installedVersionCode

    fun shouldShowPrompt(
        releaseId: String,
        installedVersionCode: Long,
        previousReleaseId: String,
        previousInstalledVersionCode: Long
    ): Boolean =
        releaseId.isNotBlank() && (
            releaseId != previousReleaseId ||
                installedVersionCode != previousInstalledVersionCode
        )
}
