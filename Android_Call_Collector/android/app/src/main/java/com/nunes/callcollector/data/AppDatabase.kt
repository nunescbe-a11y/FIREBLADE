package com.nunes.callcollector.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(entities = [CallEntity::class, RecordingEntity::class], version = 3, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun callDao(): CallDao
    abstract fun recordingDao(): RecordingDao

    companion object {
        @Volatile private var INSTANCE: AppDatabase? = null

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE calls ADD COLUMN phoneAccountId TEXT")
                db.execSQL("ALTER TABLE calls ADD COLUMN phoneAccountComponent TEXT")
                db.execSQL("ALTER TABLE calls ADD COLUMN subscriptionId INTEGER")
                db.execSQL("ALTER TABLE calls ADD COLUMN simSlotIndex INTEGER")
            }
        }

        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `recordings` (" +
                    "`localId` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
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
                    "`mimeType` TEXT NOT NULL)"
                )
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_recordings_sourceCallId_sha256` ON `recordings` (`sourceCallId`, `sha256`)")
            }
        }

        fun get(context: Context): AppDatabase = INSTANCE ?: synchronized(this) {
            INSTANCE ?: Room.databaseBuilder(
                context.applicationContext,
                AppDatabase::class.java,
                "nunes_calls.db"
            )
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                .build()
                .also { INSTANCE = it }
        }
    }
}
