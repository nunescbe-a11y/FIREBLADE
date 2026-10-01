package com.nunes.callcollector

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneOffset

class FirebladeDatePolicyTest {
    private fun utc(y:Int,m:Int,d:Int,h:Int,min:Int=0): Long =
        LocalDateTime.of(y,m,d,h,min).toInstant(ZoneOffset.UTC).toEpochMilli()

    @Test fun istMidnightStart() {
        assertEquals(utc(2026,9,17,18,30), FirebladeDatePolicy.startOfDay(utc(2026,9,18,8)))
    }

    @Test fun dateKeyUsesIst() {
        assertEquals("2026-09-18", FirebladeDatePolicy.dateKey(utc(2026,9,17,20)))
    }

    @Test fun previousUtcDayCanBeTodayIst() {
        assertEquals("2026-09-18", FirebladeDatePolicy.dateKey(utc(2026,9,17,19)))
    }

    @Test fun nextDayStartExactly24HoursInIst() {
        val start = FirebladeDatePolicy.startOfDay(utc(2026,9,18,8))
        assertEquals(24L*60*60*1000, FirebladeDatePolicy.nextDayStart(start)-start)
    }

    @Test fun pickerJanuaryIsMonthZero() {
        assertEquals("2026-01-15", FirebladeDatePolicy.dateKey(FirebladeDatePolicy.fromPicker(2026,0,15)))
    }

    @Test fun pickerDecemberWorks() {
        assertEquals("2026-12-31", FirebladeDatePolicy.dateKey(FirebladeDatePolicy.fromPicker(2026,11,31)))
    }

    @Test fun displayDateStable() {
        assertEquals("18 Sep 2026", FirebladeDatePolicy.displayDate(FirebladeDatePolicy.fromPicker(2026,8,18)))
    }

    @Test fun morningGreeting() {
        assertEquals("Good morning", FirebladeDatePolicy.greeting(utc(2026,9,18,3))) // 08:30 IST
    }

    @Test fun afternoonGreeting() {
        assertEquals("Good afternoon", FirebladeDatePolicy.greeting(utc(2026,9,18,9))) // 14:30 IST
    }

    @Test fun eveningGreeting() {
        assertEquals("Good evening", FirebladeDatePolicy.greeting(utc(2026,9,18,14))) // 19:30 IST
    }

    @Test fun todayDetectionUsesIst() {
        val now = utc(2026,9,18,2)
        val day = FirebladeDatePolicy.startOfDay(now)
        assertTrue(FirebladeDatePolicy.isToday(day, now))
    }

    @Test fun futureDetectionUsesIst() {
        val now = utc(2026,9,18,2)
        val tomorrow = FirebladeDatePolicy.nextDayStart(FirebladeDatePolicy.todayStart(now))
        assertTrue(FirebladeDatePolicy.isFuture(tomorrow, now))
    }
}
