package com.nunes.callcollector.control
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.RestrictionsManager
import com.nunes.callcollector.ConfigStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
object ManagedConfiguration {
    suspend fun apply(context:Context) {
        val r=context.getSystemService(RestrictionsManager::class.java)?.applicationRestrictions ?: return
        val config=ConfigStore(context)
        val url=r.getString("api_url")?.trim()?.trimEnd('/')
        val id=r.getString("device_id")?.trim()?.uppercase()
        if(url?.startsWith("https://")==true&&id?.matches(Regex("[A-Z0-9_-]{1,100}"))==true){
            if(config.apiUrl!=url||config.deviceId!=id)config.deviceToken=""
            config.apiUrl=url;config.deviceId=id
            val code=r.getString("enrollment_code")
            if(config.deviceToken.isBlank()&&!code.isNullOrBlank()){
                val response=DeviceApi.request(config,"/api/v3/enroll",JSONObject().put("device_id",id).put("code",code),false)
                config.deviceToken=response.getString("device_token")
            }
        }
    }
}
class ManagedConfigReceiver:BroadcastReceiver(){
    override fun onReceive(context:Context,intent:Intent){
        if(intent.action!="android.intent.action.APPLICATION_RESTRICTIONS_CHANGED")return
        val pending=goAsync()
        CoroutineScope(Dispatchers.IO).launch{try{ManagedConfiguration.apply(context)}catch(_:Exception){}finally{pending.finish()}}
    }
}
