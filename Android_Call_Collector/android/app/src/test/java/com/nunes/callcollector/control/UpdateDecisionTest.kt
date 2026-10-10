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
    fun reopeningAppDoesNotPromptAgainForSameInstalledVersionAndRelease() {
        assertTrue(UpdateDecision.shouldShowPrompt("release-38", 34, "", -1))
        assertFalse(UpdateDecision.shouldShowPrompt("release-38", 34, "release-38", 34))
        // Even if the user returns tomorrow, there is no repeated modal.
        assertFalse(UpdateDecision.shouldShowPrompt("release-38", 34, "release-38", 34))
    }

    @Test
    fun newVersionOrNewReleaseMayBeOfferedOnce() {
        assertTrue(UpdateDecision.shouldShowPrompt("release-39", 34, "release-38", 34))
        assertTrue(UpdateDecision.shouldShowPrompt("release-38", 35, "release-38", 34))
        assertFalse(UpdateDecision.shouldShowPrompt("", 34, "", -1))
    }

    @Test
    fun successfulInstallDisqualifiesCachedReleaseBeforeAnyPrompt() {
        // AppUpdater.pendingRelease validates needsUpdate first, then shouldShowPrompt.
        assertFalse(UpdateDecision.needsUpdate(38, 38))
        assertFalse(UpdateDecision.needsUpdate(39, 38))
    }
}
