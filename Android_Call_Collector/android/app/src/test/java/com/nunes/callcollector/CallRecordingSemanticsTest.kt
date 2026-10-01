package com.nunes.callcollector

import androidx.sqlite.db.SupportSQLiteDatabase
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.data.RecordingEntity
import org.junit.Assert.*
import org.junit.Test
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Method
import java.lang.reflect.Proxy

class CallRecordingSemanticsTest {

    @Test
    fun voiceCallSuccessSemantics() {
        val entity = RecordingEntity(
            sourceCallId = "call-123",
            sha256 = "dummy-sha256",
            filePath = "/data/user/0/com.nunes.callcollector/files/rec.mp4",
            fileSizeBytes = 1024,
            durationMs = 5000,
            recordingSource = "MEDIARECORDER_VOICE_CALL",
            audioScope = "BOTH_SIDES_CANDIDATE",
            capability = "VOICE_CALL",
            employeeNoticeStatus = "NOT_CAPTURED",
            customerConsentStatus = "UNKNOWN",
            consentBasis = "NOT_RECORDED",
            startedAtEpochMs = 1000L,
            endedAtEpochMs = 6000L,
            uploadStatus = "PENDING",
            phoneNumber = "+919876543210",
            direction = "INCOMING"
        )

        assertEquals("MEDIARECORDER_VOICE_CALL", entity.recordingSource)
        assertEquals("BOTH_SIDES_CANDIDATE", entity.audioScope)
        assertEquals("VOICE_CALL", entity.capability)
        assertEquals("UNKNOWN", entity.customerConsentStatus)
        assertEquals("NOT_RECORDED", entity.consentBasis)
        assertEquals("audio/mp4", entity.mimeType)
        assertEquals("PENDING", entity.uploadStatus)
        assertNotEquals("BOTH_SIDES", entity.audioScope)
    }

    @Test
    fun micFallbackSemantics() {
        val entity = RecordingEntity(
            sourceCallId = "call-456",
            sha256 = "dummy-sha256-mic",
            filePath = "/data/user/0/com.nunes.callcollector/files/rec_mic.mp4",
            fileSizeBytes = 2048,
            durationMs = 10000,
            recordingSource = "MEDIARECORDER_MIC",
            audioScope = "EMPLOYEE_ONLY",
            capability = "MIC_ONLY",
            employeeNoticeStatus = "NOT_CAPTURED",
            customerConsentStatus = "UNKNOWN",
            consentBasis = "NOT_RECORDED",
            startedAtEpochMs = 2000L,
            endedAtEpochMs = 12000L,
            uploadStatus = "PENDING",
            phoneNumber = "+919876543210",
            direction = "OUTGOING"
        )

        assertEquals("MEDIARECORDER_MIC", entity.recordingSource)
        assertEquals("EMPLOYEE_ONLY", entity.audioScope)
        assertEquals("MIC_ONLY", entity.capability)
        assertEquals("UNKNOWN", entity.customerConsentStatus)
        assertEquals("NOT_RECORDED", entity.consentBasis)
    }

    @Test
    fun osBlockedFailureRecordSemantics() {
        val entity = RecordingEntity(
            sourceCallId = null,
            sha256 = null,
            filePath = null,
            fileSizeBytes = 0,
            durationMs = 0,
            recordingSource = "OS_BLOCKED",
            audioScope = "NONE",
            capability = "NONE",
            employeeNoticeStatus = "NOT_CAPTURED",
            customerConsentStatus = "UNKNOWN",
            consentBasis = "NOT_RECORDED",
            startedAtEpochMs = 1000L,
            endedAtEpochMs = 1000L,
            uploadStatus = "FAILED_BLOCKED_BY_OS",
            phoneNumber = "+919876543210",
            direction = "INCOMING"
        )

        assertEquals("OS_BLOCKED", entity.recordingSource)
        assertEquals("NONE", entity.audioScope)
        assertEquals("NONE", entity.capability)
        assertEquals("FAILED_BLOCKED_BY_OS", entity.uploadStatus)
        assertNull(entity.filePath)
        assertNull(entity.sha256)
    }

    @Test
    fun unsupportedFailureRecordSemantics() {
        val entity = RecordingEntity(
            sourceCallId = null,
            sha256 = null,
            filePath = null,
            fileSizeBytes = 0,
            durationMs = 0,
            recordingSource = "UNSUPPORTED",
            audioScope = "NONE",
            capability = "NONE",
            employeeNoticeStatus = "NOT_CAPTURED",
            customerConsentStatus = "UNKNOWN",
            consentBasis = "NOT_RECORDED",
            startedAtEpochMs = 1000L,
            endedAtEpochMs = 1000L,
            uploadStatus = "FAILED_UNSUPPORTED",
            phoneNumber = null,
            direction = null
        )

        assertEquals("UNSUPPORTED", entity.recordingSource)
        assertEquals("FAILED_UNSUPPORTED", entity.uploadStatus)
    }

    @Test
    fun migration1To2ExecutesValidAlterTables() {
        val executedSql = mutableListOf<String>()
        val mockDb = createMockDatabase(executedSql)

        AppDatabase.MIGRATION_1_2.migrate(mockDb)

        assertEquals(4, executedSql.size)
        assertTrue(executedSql.any { it.contains("ALTER TABLE calls ADD COLUMN phoneAccountId TEXT") })
        assertTrue(executedSql.any { it.contains("ALTER TABLE calls ADD COLUMN phoneAccountComponent TEXT") })
        assertTrue(executedSql.any { it.contains("ALTER TABLE calls ADD COLUMN subscriptionId INTEGER") })
        assertTrue(executedSql.any { it.contains("ALTER TABLE calls ADD COLUMN simSlotIndex INTEGER") })
    }

    @Test
    fun migration2To3CreatesRecordingsTableAndUniqueIndex() {
        val executedSql = mutableListOf<String>()
        val mockDb = createMockDatabase(executedSql)

        AppDatabase.MIGRATION_2_3.migrate(mockDb)

        assertEquals(2, executedSql.size)
        val createTable = executedSql[0]
        val createIndex = executedSql[1]

        assertTrue(createTable.startsWith("CREATE TABLE IF NOT EXISTS `recordings`"))
        assertTrue(createTable.contains("`recordingId` TEXT NOT NULL"))
        assertTrue(createTable.contains("`sourceCallId` TEXT"))
        assertTrue(createTable.contains("`sha256` TEXT"))
        assertTrue(createTable.contains("`recordingSource` TEXT NOT NULL"))
        assertTrue(createTable.contains("`audioScope` TEXT NOT NULL"))
        assertTrue(createTable.contains("`capability` TEXT NOT NULL"))
        assertTrue(createTable.contains("`uploadStatus` TEXT NOT NULL"))

        assertTrue(createIndex.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS `index_recordings_sourceCallId_sha256` ON `recordings` (`sourceCallId`, `sha256`)"))
    }

    @Test
    fun fullMigrationChainFromV1ToV3() {
        val executedSql = mutableListOf<String>()
        val mockDb = createMockDatabase(executedSql)

        // v1 -> v2
        AppDatabase.MIGRATION_1_2.migrate(mockDb)
        // v2 -> v3
        AppDatabase.MIGRATION_2_3.migrate(mockDb)

        assertEquals(6, executedSql.size)
        assertEquals(1, AppDatabase.MIGRATION_1_2.startVersion)
        assertEquals(2, AppDatabase.MIGRATION_1_2.endVersion)
        assertEquals(2, AppDatabase.MIGRATION_2_3.startVersion)
        assertEquals(3, AppDatabase.MIGRATION_2_3.endVersion)
    }

    private fun createMockDatabase(executedSql: MutableList<String>): SupportSQLiteDatabase {
        val handler = InvocationHandler { _, method: Method, args: Array<out Any>? ->
            if (method.name == "execSQL" && args != null && args.isNotEmpty()) {
                executedSql.add(args[0] as String)
            }
            null
        }
        return Proxy.newProxyInstance(
            SupportSQLiteDatabase::class.java.classLoader,
            arrayOf(SupportSQLiteDatabase::class.java),
            handler
        ) as SupportSQLiteDatabase
    }
}
