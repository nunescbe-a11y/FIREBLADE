package com.nunes.callcollector
import android.content.Context
import android.text.InputType
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
object AdminGate {
    private fun hash(pin:String,salt:ByteArray) = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(pin.toCharArray(),salt,120000,256)).encoded
    fun unlock(activity:AppCompatActivity,onSuccess:()->Unit) {
        val p=activity.getSharedPreferences("fireblade_admin",Context.MODE_PRIVATE)
        if(p.getLong("locked_until",0)>System.currentTimeMillis()){Toast.makeText(activity,"Try again in one minute",Toast.LENGTH_LONG).show();return}
        val configured=p.contains("pin_hash")
        val field=EditText(activity).apply{inputType=InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD;hint=if(configured)"Admin PIN" else "Create a PIN (6–12 digits)";setPadding(32,24,32,24)}
        AlertDialog.Builder(activity).setTitle(if(configured)"Admin access" else "Set Admin PIN").setView(field).setNegativeButton("Cancel",null).setPositiveButton(if(configured)"Unlock" else "Set PIN"){_,_->
            val pin=field.text.toString()
            if(!pin.matches(Regex("[0-9]{6,12}"))){Toast.makeText(activity,"Use 6–12 digits",Toast.LENGTH_LONG).show();return@setPositiveButton}
            activity.lifecycleScope.launch {
                val valid=withContext(Dispatchers.Default){
                    if(!configured){
                        val salt=ByteArray(16).also{SecureRandom().nextBytes(it)}
                        p.edit().putString("pin_salt",android.util.Base64.encodeToString(salt,2)).putString("pin_hash",android.util.Base64.encodeToString(hash(pin,salt),2)).apply();true
                    }else{
                        val salt=android.util.Base64.decode(p.getString("pin_salt","")!!,2)
                        MessageDigest.isEqual(hash(pin,salt),android.util.Base64.decode(p.getString("pin_hash","")!!,2))
                    }
                }
                if(valid){p.edit().putInt("failures",0).apply();onSuccess()}
                else{val n=p.getInt("failures",0)+1;p.edit().putInt("failures",n).putLong("locked_until",if(n>=5)System.currentTimeMillis()+60000 else 0).apply();Toast.makeText(activity,"Incorrect Admin PIN",Toast.LENGTH_LONG).show()}
            }
        }.show()
    }
}
