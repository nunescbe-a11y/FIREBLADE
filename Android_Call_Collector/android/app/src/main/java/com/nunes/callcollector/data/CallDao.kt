package com.nunes.callcollector.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface CallDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(rows: List<CallEntity>): List<Long>

    @Query("SELECT * FROM calls ORDER BY startedAtEpochMs DESC LIMIT :limit")
    suspend fun latest(limit: Int = 20): List<CallEntity>

    @Query(
        "SELECT * FROM calls " +
            "WHERE durationSeconds > 0 " +
            "AND direction IN ('INCOMING_ANSWERED', 'OUTGOING_CONNECTED') " +
            "ORDER BY startedAtEpochMs DESC LIMIT 1"
    )
    suspend fun latestSpoken(): CallEntity?

    @Query("SELECT * FROM calls WHERE synced = 0 ORDER BY startedAtEpochMs ASC LIMIT :limit")
    suspend fun pending(limit: Int = 200): List<CallEntity>

    @Query("UPDATE calls SET synced = 1 WHERE localId IN (:ids)")
    suspend fun markSynced(ids: List<Long>)

    @Query("SELECT COUNT(*) FROM calls")
    suspend fun totalCount(): Int

    @Query("SELECT COUNT(*) FROM calls WHERE synced = 0")
    suspend fun pendingCount(): Int

    @Query("DELETE FROM calls WHERE startedAtEpochMs < :cutoffEpochMs")
    suspend fun deleteBefore(cutoffEpochMs: Long): Int
}
