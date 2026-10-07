package com.nunes.callcollector.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface ShaneCallDetailDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(row: ShaneCallDetailEntity): Long

    @Update
    suspend fun update(row: ShaneCallDetailEntity)

    @Query("SELECT * FROM shane_call_details WHERE detailId = :detailId LIMIT 1")
    suspend fun byDetailId(detailId: String): ShaneCallDetailEntity?

    @Query("SELECT * FROM shane_call_details WHERE sourceCallId = :sourceCallId LIMIT 1")
    suspend fun bySourceCallId(sourceCallId: String): ShaneCallDetailEntity?

    @Query(
        "SELECT * FROM shane_call_details " +
            "WHERE phoneNumberNormalized = :number " +
            "AND callStartedAtEpochMs BETWEEN :fromEpochMs AND :toEpochMs " +
            "ORDER BY ABS(callStartedAtEpochMs - :targetEpochMs) ASC, updatedAtEpochMs DESC LIMIT 1"
    )
    suspend fun nearestForCall(
        number: String,
        fromEpochMs: Long,
        toEpochMs: Long,
        targetEpochMs: Long
    ): ShaneCallDetailEntity?

    @Query(
        "SELECT * FROM shane_call_details " +
            "WHERE phoneNumberNormalized = :number " +
            "AND (customerName != '' OR location != '') " +
            "ORDER BY updatedAtEpochMs DESC LIMIT 1"
    )
    suspend fun latestProfile(number: String): ShaneCallDetailEntity?

    @Query("SELECT * FROM shane_call_details ORDER BY callStartedAtEpochMs DESC LIMIT :limit")
    suspend fun latestAll(limit: Int = 10000): List<ShaneCallDetailEntity>

    @Query(
        "SELECT * FROM shane_call_details " +
            "WHERE callStartedAtEpochMs >= :startEpochMs AND callStartedAtEpochMs < :endEpochMs " +
            "ORDER BY callStartedAtEpochMs DESC"
    )
    suspend fun forDateRange(startEpochMs: Long, endEpochMs: Long): List<ShaneCallDetailEntity>

    @Query("SELECT * FROM shane_call_details WHERE synced = 0 AND syncState = 'PENDING' ORDER BY updatedAtEpochMs ASC LIMIT :limit")
    suspend fun pending(limit: Int = 100): List<ShaneCallDetailEntity>

    @Query(
        "SELECT * FROM shane_call_details " +
            "WHERE sourceCallId IS NULL OR sourceCallId = '' " +
            "ORDER BY callStartedAtEpochMs DESC LIMIT :limit"
    )
    suspend fun unlinked(limit: Int = 200): List<ShaneCallDetailEntity>

    @Query("UPDATE shane_call_details SET synced = 1, syncState = 'SYNCED', syncError = NULL WHERE detailId IN (:detailIds)")
    suspend fun markSynced(detailIds: List<String>)

    @Query(
        "UPDATE shane_call_details " +
            "SET synced = 0, syncState = 'REJECTED', syncError = :error " +
            "WHERE detailId = :detailId"
    )
    suspend fun markRejected(detailId: String, error: String)

    @Query(
        "UPDATE shane_call_details " +
            "SET sourceCallId = :sourceCallId, synced = 0, syncState = 'PENDING', syncError = NULL, updatedAtEpochMs = :updatedAtEpochMs " +
            "WHERE detailId = :detailId"
    )
    suspend fun attachSourceCall(detailId: String, sourceCallId: String, updatedAtEpochMs: Long)

    @Query("SELECT COUNT(*) FROM shane_call_details WHERE synced = 0 AND syncState = 'PENDING'")
    suspend fun pendingCount(): Int

    @Query("SELECT COUNT(*) FROM shane_call_details WHERE syncState = 'REJECTED'")
    suspend fun rejectedCount(): Int
}
