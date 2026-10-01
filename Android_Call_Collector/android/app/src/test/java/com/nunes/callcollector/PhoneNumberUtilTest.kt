package com.nunes.callcollector

import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneNumberUtilTest {
    @Test fun tenDigitsGetsIndiaPrefix() =
        assertEquals("+919876543210", PhoneNumberUtil.normalizeIndia("9876543210"))

    @Test fun leadingZeroIsRemoved() =
        assertEquals("+919876543210", PhoneNumberUtil.normalizeIndia("09876543210"))

    @Test fun countryCodeWithoutPlusIsNormalized() =
        assertEquals("+919876543210", PhoneNumberUtil.normalizeIndia("919876543210"))

    @Test fun formattedNumberIsNormalized() =
        assertEquals("+919876543210", PhoneNumberUtil.normalizeIndia("+91 98765-43210"))

    @Test fun blankStaysBlank() =
        assertEquals("", PhoneNumberUtil.normalizeIndia(""))

    @Test fun nonNumericStaysOriginal() =
        assertEquals("Unknown", PhoneNumberUtil.normalizeIndia("Unknown"))

    @Test fun shortNumericIsNotInvented() =
        assertEquals("12345", PhoneNumberUtil.normalizeIndia("12345"))

    @Test fun plusInternationalKeepsPlus() =
        assertEquals("+441234567890", PhoneNumberUtil.normalizeIndia("+44 1234 567890"))
}
