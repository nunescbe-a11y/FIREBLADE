package com.nunes.callcollector.control

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateDecisionTest {
    @Test
    fun afterSuccessfulInstallOldReleaseIsNeverEligible() {
        assertTrue(UpdateDecision.needsUpdate(34, 35))
        assertFalse(UpdateDecision.needsUpdate(35, 35))
        assertFalse(UpdateDecision.needsUpdate(36, 35))
        assertFalse(UpdateDecision.needsUpdate(34, -1))
    }

    @Test
    fun repeatPromptIsSuppressedImmediatelyAfterInstallerReturns() {
        val now = 1_800_000L
        assertTrue(UpdateDecision.shouldShowPrompt("new", "", 0L, now))
        assertTrue(UpdateDecision.shouldShowPrompt("new", "old", now - 1_000L, now))
        assertFalse(UpdateDecision.shouldShowPrompt("new", "new", now - 1_000L, now))
        assertFalse(UpdateDecision.shouldShowPrompt("new", "new", now - 899_999L, now))
        assertTrue(UpdateDecision.shouldShowPrompt("new", "new", now - 900_000L, now))
    }

    @Test
    fun corruptOrFuturePromptStateCannotBlockNewUpdates() {
        assertFalse(UpdateDecision.shouldShowPrompt("", "", 0L, 1_000L))
        assertTrue(UpdateDecision.shouldShowPrompt("release", "release", 0L, 1_000L))
        assertTrue(UpdateDecision.shouldShowPrompt("release", "release", 2_000L, 1_000L))
    }
}
