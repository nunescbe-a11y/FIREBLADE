package com.nunes.callcollector.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface ShaneAssignmentEventDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(event: ShaneAssignmentEventEntity): Long

    // Parent form must sync first; the server verifies its ownership before accepting an event.
    @Query("""SELECT e.* FROM shane_assignment_events e
        INNER JOIN shane_call_details d ON e.detailId = d.detailId
        WHERE e.synced = 0 AND d.synced = 1 AND d.syncState = 'SYNCED'
        ORDER BY e.occurredAtEpochMs ASC LIMIT :limit""")
    suspend fun pendingReady(limit: Int = 50): List<ShaneAssignmentEventEntity>

    @Query("UPDATE shane_assignment_events SET synced = 1 WHERE eventId = :eventId")
    suspend fun markSynced(eventId: String)

    @Query("SELECT COUNT(*) FROM shane_assignment_events WHERE synced = 0")
    suspend fun pendingCount(): Int
}
