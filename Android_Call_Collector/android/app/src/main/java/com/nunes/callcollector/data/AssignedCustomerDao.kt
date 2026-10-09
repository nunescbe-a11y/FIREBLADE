package com.nunes.callcollector.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface AssignedCustomerDao {
    @Query("SELECT * FROM assigned_customers ORDER BY assignedAtEpochMs DESC")
    suspend fun getAll(): List<AssignedCustomerEntity>

    @Query("SELECT * FROM assigned_customers WHERE detailId = :detailId LIMIT 1")
    suspend fun byDetailId(detailId: String): AssignedCustomerEntity?

    @Query("SELECT * FROM assigned_customers WHERE detailId = :detailId LIMIT 1")
    suspend fun getByDetailId(detailId: String): AssignedCustomerEntity?

    @Query("SELECT * FROM assigned_customers WHERE syncState = 'PENDING_SAVE' ORDER BY clientUpdatedAtEpochMs ASC")
    suspend fun getPendingUploads(): List<AssignedCustomerEntity>

    @Query("SELECT * FROM assigned_customers WHERE syncState = 'PENDING_SAVE' ORDER BY clientUpdatedAtEpochMs ASC")
    suspend fun getPendingSaves(): List<AssignedCustomerEntity>

    @Query("UPDATE assigned_customers SET syncState = 'SYNCED', syncError = NULL WHERE detailId = :detailId")
    suspend fun markSynced(detailId: String)

    @Query("SELECT COUNT(*) FROM assigned_customers WHERE status = 'PENDING'")
    suspend fun countPendingAction(): Int

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: AssignedCustomerEntity): Long

    @Update
    suspend fun update(entity: AssignedCustomerEntity)

    @Query("DELETE FROM assigned_customers WHERE detailId = :detailId")
    suspend fun deleteByDetailId(detailId: String)
}
