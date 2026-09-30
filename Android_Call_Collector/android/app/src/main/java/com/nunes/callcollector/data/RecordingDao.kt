package com.nunes.callcollector.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface RecordingDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(recording: RecordingEntity): Long

    @Update
    suspend fun update(recording: RecordingEntity)

    @Query("SELECT * FROM recordings WHERE uploadStatus = 'PENDING' OR uploadStatus = 'FAILED' ORDER BY createdAtEpochMs ASC LIMIT :limit")
    suspend fun pending(limit: Int = 20): List<RecordingEntity>

    @Query("UPDATE recordings SET uploadStatus = :status WHERE localId IN (:ids)")
    suspend fun updateStatus(ids: List<Long>, status: String)

    @Query("SELECT * FROM recordings WHERE sourceCallId = :sourceCallId LIMIT 1")
    suspend fun getBySourceCallId(sourceCallId: String): RecordingEntity?

    @Query("DELETE FROM recordings WHERE createdAtEpochMs < :cutoffEpochMs")
    suspend fun deleteBefore(cutoffEpochMs: Long): Int
}
