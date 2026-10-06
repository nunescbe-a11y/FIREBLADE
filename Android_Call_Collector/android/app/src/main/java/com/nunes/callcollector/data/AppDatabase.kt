package com.nunes.callcollector.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [CallEntity::class, RecordingEntity::class, ShaneCallDetailEntity::class],
    version = 5,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun callDao(): CallDao
    abstract fun recordingDao(): RecordingDao
    abstract fun shaneCallDetailDao(): ShaneCallDetailDao

    companion object {
        @Volatile private var INSTANCE: AppDatabase? = null

        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE calls ADD COLUMN phoneAccountId TEXT")
                db.execSQL("ALTER TABLE calls ADD COLUMN phoneAccountComponent TEXT")
                db.execSQL("ALTER TABLE calls ADD COLUMN subscriptionId INTEGER")
                db.execSQL("ALTER TABLE calls ADD COLUMN simSlotIndex INTEGER")
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `recordings` (" +
                    "`localId` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                    "`recordingId` TEXT NOT NULL, " +
                    "`sourceCallId` TEXT, " +
                    "`sha256` TEXT, " +
                    "`filePath` TEXT, " +
                    "`fileSizeBytes` INTEGER NOT NULL, " +
                    "`durationMs` INTEGER NOT NULL, " +
                    "`recordingSource` TEXT NOT NULL, " +
                    "`audioScope` TEXT NOT NULL, " +
                    "`capability` TEXT NOT NULL, " +
                    "`employeeNoticeStatus` TEXT NOT NULL, " +
                    "`customerConsentStatus` TEXT NOT NULL, " +
                    "`consentBasis` TEXT NOT NULL, " +
                    "`uploadStatus` TEXT NOT NULL, " +
                    "`createdAtEpochMs` INTEGER NOT NULL, " +
                    "`startedAtEpochMs` INTEGER NOT NULL, " +
                    "`endedAtEpochMs` INTEGER NOT NULL, " +
                    "`mimeType` TEXT NOT NULL, " +
                    "`phoneNumber` TEXT, " +
                    "`direction` TEXT)"
                )
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_recordings_sourceCallId_sha256` ON `recordings` (`sourceCallId`, `sha256`)")
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `shane_call_details` (" +
                    "`localId` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                    "`detailId` TEXT NOT NULL, " +
                    "`sourceCallId` TEXT, " +
                    "`phoneNumberRaw` TEXT NOT NULL, " +
                    "`phoneNumberNormalized` TEXT NOT NULL, " +
                    "`callStartedAtEpochMs` INTEGER NOT NULL, " +
                    "`customerName` TEXT NOT NULL, " +
                    "`productAsked` TEXT NOT NULL, " +
                    "`location` TEXT NOT NULL, " +
                    "`notes` TEXT NOT NULL, " +
                    "`veryUrgent` INTEGER NOT NULL, " +
                    "`synced` INTEGER NOT NULL, " +
                    "`createdAtEpochMs` INTEGER NOT NULL, " +
                    "`updatedAtEpochMs` INTEGER NOT NULL)"
                )
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_shane_call_details_detailId` ON `shane_call_details` (`detailId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_shane_call_details_sourceCallId` ON `shane_call_details` (`sourceCallId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_shane_call_details_phoneNumberNormalized` ON `shane_call_details` (`phoneNumberNormalized`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_shane_call_details_callStartedAtEpochMs` ON `shane_call_details` (`callStartedAtEpochMs`)")
            }
        }

        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `shane_call_details` ADD COLUMN `syncState` TEXT NOT NULL DEFAULT 'PENDING'")
                db.execSQL("ALTER TABLE `shane_call_details` ADD COLUMN `syncError` TEXT")
                db.execSQL("UPDATE `shane_call_details` SET `syncState` = 'SYNCED' WHERE `synced` = 1")
                db.execSQL("UPDATE `shane_call_details` SET `syncState` = 'PENDING' WHERE `synced` = 0")
            }
        }

        fun get(context: Context): AppDatabase = INSTANCE ?: synchronized(this) {
            INSTANCE ?: Room.databaseBuilder(
                context.applicationContext,
                AppDatabase::class.java,
                "nunes_calls.db"
            )
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
                .build()
                .also { INSTANCE = it }
        }
    }
}
