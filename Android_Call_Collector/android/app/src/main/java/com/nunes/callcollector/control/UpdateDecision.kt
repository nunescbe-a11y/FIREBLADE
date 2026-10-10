package com.nunes.callcollector.control

/**
 * The Android PackageManager version is authoritative for whether a release
 * is needed. The automatic startup offer is once per release ID, regardless
 * of intermediate installed versions, so a successful partial upgrade or an
 * installer cancellation cannot cause the same popup on every app launch.
 *
 * An offered release remains reachable via Advanced Admin and the download
 * notification. A different release ID is eligible for one new offer.
 */
internal object UpdateDecision {
    fun needsUpdate(installedVersionCode: Long, releaseVersionCode: Long): Boolean =
        releaseVersionCode > installedVersionCode

    fun shouldShowPrompt(
        releaseId: String,
        previouslyOfferedReleaseId: String
    ): Boolean =
        releaseId.isNotBlank() && releaseId != previouslyOfferedReleaseId
}
