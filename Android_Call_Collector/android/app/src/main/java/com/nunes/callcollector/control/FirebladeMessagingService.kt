package com.nunes.callcollector.control
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.nunes.callcollector.ConfigStore
class FirebladeMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        ConfigStore(this).pushToken = token
        CommandWorker.enqueue(this)
    }
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data["command"] == "CHECK_NOW") {
            val id = message.data["request_id"] ?: return
            try { java.util.UUID.fromString(id) } catch (_: Exception) { return }
            CommandWorker.enqueue(this, id)
        }
    }
}
