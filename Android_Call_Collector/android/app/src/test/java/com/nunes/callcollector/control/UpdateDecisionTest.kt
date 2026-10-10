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
        // AppUpdater.pendingRelease checks needsUpdate before shouldShowPrompt.
        assertFalse(UpdateDecision.needsUpdate(38, 38))
        assertFalse(UpdateDecision.needsUpdate(39, 38))
    }
}
