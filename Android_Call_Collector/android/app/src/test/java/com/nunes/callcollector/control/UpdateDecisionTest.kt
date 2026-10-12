package com.nunes.callcollector.control

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateDecisionTest {
    @Test
    fun installedVersionNeverOffersSameOrOlderApk() {
        assertTrue(UpdateDecision.needsUpdate(34, 35))
        assertFalse(UpdateDecision.needsUpdate(35, 35))
        assertFalse(UpdateDecision.needsUpdate(36, 35))
        assertFalse(UpdateDecision.needsUpdate(34, -1))
        assertFalse(UpdateDecision.needsUpdate(38, 38))
    }

    @Test
    fun sameReleaseIsNeverPromptedAgainOnAppRestartOrCancelledInstall() {
        assertTrue(UpdateDecision.shouldShowPrompt("release-38", ""))
        assertFalse(UpdateDecision.shouldShowPrompt("release-38", "release-38"))
        // It must remain suppressed indefinitely, including after an
        // intermediate installation that did not yet reach this release.
        assertFalse(UpdateDecision.shouldShowPrompt("release-38", "release-38"))
    }

    @Test
    fun laterReleaseStillGetsOnePrompt() {
        assertTrue(UpdateDecision.shouldShowPrompt("release-39", "release-38"))
        assertFalse(UpdateDecision.shouldShowPrompt("release-39", "release-39"))
        assertFalse(UpdateDecision.shouldShowPrompt("", ""))
    }

    @Test
    fun successfulInstallDisqualifiesCachedReleaseBeforeAnyPrompt() {
        // Build 40 must invalidate an old Build 40 cached APK even if its
        // metadata and notification survive Android's package replacement.
        assertFalse(UpdateDecision.needsUpdate(40, 40))
        assertFalse(UpdateDecision.needsUpdate(40, 39))
        assertFalse(UpdateDecision.shouldOfferInstallPrompt(40, 40, "build-40", ""))
        assertFalse(UpdateDecision.shouldOfferInstallPrompt(40, 39, "build-39", ""))
        assertFalse(UpdateDecision.shouldOfferInstallPrompt(41, 40, "build-40", ""))
    }

    @Test
    fun restartAfterInstallNeverShowsTheSameBuild40DialogAgain() {
        val build40 = "shane-build-40-release"
        // Phone starts on Build 39 and receives one valid prompt.
        assertTrue(UpdateDecision.shouldOfferInstallPrompt(39, 40, build40, ""))
        // Reopening the old app without installing cannot spam the same prompt.
        assertFalse(UpdateDecision.shouldOfferInstallPrompt(39, 40, build40, build40))
        // After Android updates the installed package to 40, a stale cached
        // release ID must NEVER cause another "Install update" popup.
        repeat(10) {
            assertFalse(UpdateDecision.shouldOfferInstallPrompt(40, 40, build40, ""))
            assertFalse(UpdateDecision.shouldOfferInstallPrompt(40, 40, build40, build40))
        }
    }

    @Test
    fun installedBuild40OnlyOffersAnActuallyNewerReleaseOnce() {
        assertTrue(UpdateDecision.shouldOfferInstallPrompt(40, 41, "build-41", "build-40"))
        assertFalse(UpdateDecision.shouldOfferInstallPrompt(40, 41, "build-41", "build-41"))
        assertFalse(UpdateDecision.shouldOfferInstallPrompt(40, -1, "bad-metadata", ""))
        assertFalse(UpdateDecision.shouldOfferInstallPrompt(40, 40, "", ""))
    }
}
