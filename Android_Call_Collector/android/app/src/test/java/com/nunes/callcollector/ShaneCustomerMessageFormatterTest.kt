package com.nunes.callcollector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class ShaneCustomerMessageFormatterTest {
    private val callTime = ZonedDateTime.of(
        2026, 10, 9, 10, 30, 0, 0, ZoneId.of("Asia/Kolkata")
    ).toInstant().toEpochMilli()

    @Test
    fun employeeInboxUsesIdenticalWhatsAppFieldOrder() {
        val message = ShaneCustomerMessageFormatter.format(
            customerName = "Customer A",
            phone = "+919876543210",
            productAsked = "Water Pump",
            location = "Coimbatore",
            notes = "Call before noon",
            quotation = false,
            catalogue = false,
            image = false,
            veryUrgent = true,
            callStartedAtEpochMs = callTime
        )
        assertEquals(
            "Customer Name: Customer A\n\n" +
                "Customer Number: +919876543210\n\n" +
                "Product Asked: Water Pump\n\n" +
                "Location: Coimbatore\n\n" +
                "Date & Time: 09 Oct 2026 • 10:30 AM\n\n" +
                "Priority: VERY URGENT\n\n" +
                "Notes: Call before noon",
            message
        )
    }

    @Test
    fun optionalFieldsFollowOriginalWhatsAppFormat() {
        val message = ShaneCustomerMessageFormatter.format(
            customerName = "Customer B",
            phone = "9000000000",
            productAsked = "Pumps",
            location = "Salem",
            notes = "",
            quotation = true,
            catalogue = false,
            image = true,
            veryUrgent = false,
            callStartedAtEpochMs = callTime
        )
        assertTrue(message.contains("Required: Quotation, Image"))
        assertFalse(message.contains("Priority:"))
        assertFalse(message.contains("Notes:"))
    }
}
