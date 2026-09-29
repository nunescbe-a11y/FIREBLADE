package com.nunes.callcollector

object PhoneNumberUtil {
    fun normalizeIndia(raw: String): String {
        val digits = raw.filter { it.isDigit() }
        if (digits.isBlank()) return raw
        return when {
            digits.length == 10 -> "+91$digits"
            digits.length == 11 && digits.startsWith("0") -> "+91${digits.drop(1)}"
            digits.length == 12 && digits.startsWith("91") -> "+$digits"
            raw.trim().startsWith("+") -> "+$digits"
            else -> digits
        }
    }
}
