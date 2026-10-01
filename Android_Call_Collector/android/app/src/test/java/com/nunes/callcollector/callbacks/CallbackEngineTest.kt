package com.nunes.callcollector.callbacks

import com.nunes.callcollector.FirebladeDatePolicy
import com.nunes.callcollector.data.CallEntity
import org.junit.Assert.*
import org.junit.Test

class CallbackEngineTest {
    private val day = FirebladeDatePolicy.fromPicker(2026, 8, 18)
    private fun call(
        id: String,
        number: String,
        direction: String,
        offsetMinutes: Long,
        duration: Long = 0,
        raw: String = number
    ) = CallEntity(
        sourceCallId = id,
        numberRaw = raw,
        numberNormalized = number,
        contactName = null,
        direction = direction,
        startedAtEpochMs = day + offsetMinutes * 60_000L,
        durationSeconds = duration
    )

    @Test fun totalIncomingCountsActualCallsNotUniqueCustomers() {
        val s = CallbackEngine.computeForDay(listOf(
            call("1","+919999999999","INCOMING_ANSWERED",10),
            call("2","+919999999999","INCOMING_MISSED",20)
        ), day, now = day + 60*60_000L)
        assertEquals(2, s.totalIncomingCount)
    }

    @Test fun answeredCountCorrect() {
        val s = CallbackEngine.computeForDay(listOf(
            call("1","+911","INCOMING_ANSWERED",10),
            call("2","+912","INCOMING_MISSED",20)
        ), day)
        assertEquals(1, s.answeredCount)
    }

    @Test fun missedCountCorrect() {
        val s = CallbackEngine.computeForDay(listOf(
            call("1","+911","INCOMING_ANSWERED",10),
            call("2","+912","INCOMING_MISSED",20)
        ), day)
        assertEquals(1, s.missedCount)
    }

    @Test fun outgoingDoesNotIncreaseIncomingTotal() {
        val s = CallbackEngine.computeForDay(listOf(
            call("1","+911","OUTGOING_CONNECTED",10,30),
            call("2","+912","OUTGOING_UNANSWERED",20)
        ), day)
        assertEquals(0, s.totalIncomingCount)
    }

    @Test fun missedCreatesPending() {
        val s = CallbackEngine.computeForDay(listOf(call("1","+911","INCOMING_MISSED",10)), day)
        assertEquals(1, s.pendingCount)
    }

    @Test fun connectedOutgoingResolvesMiss() {
        val s = CallbackEngine.computeForDay(listOf(
            call("1","+911","INCOMING_MISSED",10),
            call("2","+911","OUTGOING_CONNECTED",20,30)
        ), day)
        assertEquals(0, s.pendingCount)
        assertEquals(1, s.resolvedToday)
    }

    @Test fun incomingAnsweredAfterMissResolves() {
        val s = CallbackEngine.computeForDay(listOf(
            call("1","+911","INCOMING_MISSED",10),
            call("2","+911","INCOMING_ANSWERED",20,30)
        ), day)
        assertEquals(0, s.pendingCount)
    }

    @Test fun unansweredOutgoingKeepsPending() {
        val s = CallbackEngine.computeForDay(listOf(
            call("1","+911","INCOMING_MISSED",10),
            call("2","+911","OUTGOING_UNANSWERED",20)
        ), day)
        assertEquals(1, s.pendingCount)
        assertNotNull(s.pending.single().latestAttemptAt)
    }

    @Test fun repeatMissesBecomeOneCustomerTask() {
        val s = CallbackEngine.computeForDay(listOf(
            call("1","+911","INCOMING_MISSED",10),
            call("2","+911","INCOMING_MISSED",20)
        ), day)
        assertEquals(1, s.pendingCount)
        assertEquals(2, s.pending.single().missedCount)
    }

    @Test fun differentCustomersRemainSeparate() {
        val s = CallbackEngine.computeForDay(listOf(
            call("1","+911","INCOMING_MISSED",10),
            call("2","+912","INCOMING_MISSED",20)
        ), day)
        assertEquals(2, s.pendingCount)
    }

    @Test fun previousDayMissNotIncluded() {
        val previous = day - 60_000L
        val row = CallEntity(
            sourceCallId="x", numberRaw="+911", numberNormalized="+911",
            contactName=null, direction="INCOMING_MISSED",
            startedAtEpochMs=previous, durationSeconds=0
        )
        val s = CallbackEngine.computeForDay(listOf(row), day)
        assertEquals(0, s.pendingCount)
        assertEquals(0, s.missedCount)
    }

    @Test fun callbackOnLaterDayStillResolvesSelectedMiss() {
        val s = CallbackEngine.computeForDay(listOf(
            call("1","+911","INCOMING_MISSED",10),
            CallEntity(
                sourceCallId="2", numberRaw="+911", numberNormalized="+911",
                contactName=null, direction="OUTGOING_CONNECTED",
                startedAtEpochMs=FirebladeDatePolicy.nextDayStart(day)+10*60_000L,
                durationSeconds=30
            )
        ), day)
        assertEquals(0, s.pendingCount)
    }

    @Test fun callbackBeforeMissDoesNotResolve() {
        val s = CallbackEngine.computeForDay(listOf(
            call("1","+911","OUTGOING_CONNECTED",5,30),
            call("2","+911","INCOMING_MISSED",10)
        ), day)
        assertEquals(1, s.pendingCount)
    }

    @Test fun rawNumberFallbackGroupsCalls() {
        val s = CallbackEngine.computeForDay(listOf(
            call("1","","INCOMING_MISSED",10, raw="98765"),
            call("2","","OUTGOING_CONNECTED",20,30, raw="98765")
        ), day)
        assertEquals(0, s.pendingCount)
    }

    @Test fun pendingSortsByFirstMissAscending() {
        val s = CallbackEngine.computeForDay(listOf(
            call("2","+912","INCOMING_MISSED",20),
            call("1","+911","INCOMING_MISSED",10)
        ), day)
        assertEquals("+911", s.pending.first().key)
    }

    @Test fun overdueCountUsesGeneratedTime() {
        val s = CallbackEngine.computeForDay(
            listOf(call("1","+911","INCOMING_MISSED",10)),
            day,
            now = day + 3*60*60_000L
        )
        assertEquals(1, s.overdueCount)
    }
}
