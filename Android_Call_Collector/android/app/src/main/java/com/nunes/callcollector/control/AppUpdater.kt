package com.nunes.callcollector.control
import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.nunes.callcollector.ConfigStore
import com.nunes.callcollector.MainActivity
import com.nunes.callcollector.R
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
object AppUpdater {
    private const val LIMIT = 157286400L
    private const val PROMPT_PREFS = "fireblade_update_prompt"
    fun version(context: Context): Long = code(context.packageManager.getPackageInfo(context.packageName,0))
    @Suppress("DEPRECATION") private fun code(p: PackageInfo) = if(Build.VERSION.SDK_INT>=28)p.longVersionCode else p.versionCode.toLong()
    private fun file(context: Context) = File(File(context.cacheDir,"updates").apply { mkdirs() },"fireblade.apk")

    private fun clearPending(context: Context) {
        ConfigStore(context).availableRelease = ""
        file(context).delete()
        context.getSystemService(NotificationManager::class.java)?.cancel(36)
        context.getSharedPreferences(PROMPT_PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    // Android preserves SharedPreferences through an APK replacement. An old
    // availableRelease flag is not proof that this phone still needs an update.
    private fun pendingRelease(context: Context): JSONObject? {
        val cached = ConfigStore(context).availableRelease
        if (cached.isBlank()) return null
        val release = try { JSONObject(cached) } catch (_: Exception) { null }
        if (release == null || release.optString("id").isBlank() ||
            release.optString("package_name") != context.packageName ||
            !UpdateDecision.needsUpdate(version(context), release.optLong("version_code", -1L))
        ) {
            clearPending(context)
            return null
        }
        return release
    }

    fun reconcileInstalledState(context: Context) {
        pendingRelease(context)
    }

    fun ready(context: Context): Boolean {
        val release = pendingRelease(context) ?: return false
        val size = release.optLong("size_bytes", -1L)
        val apk = file(context)
        return size > 0 && apk.isFile && apk.length() == size
    }

    fun shouldPrompt(context: Context): Boolean {
        if (!ready(context)) return false
        val id = pendingRelease(context)?.optString("id").orEmpty()
        val prefs = context.getSharedPreferences(PROMPT_PREFS, Context.MODE_PRIVATE)
        return UpdateDecision.shouldShowPrompt(
            id, prefs.getString("release", "").orEmpty(),
            prefs.getLong("at", 0), System.currentTimeMillis()
        )
    }

    fun recordPromptShown(context: Context) {
        val release = pendingRelease(context) ?: return
        context.getSharedPreferences(PROMPT_PREFS, Context.MODE_PRIVATE).edit()
            .putString("release", release.optString("id"))
            .putLong("at", System.currentTimeMillis()).apply()
    }

    private fun report(config:ConfigStore, context:Context, release:JSONObject?, stage:String,message:String="") {
        try { DeviceApi.request(config,DeviceApi.devicePath(config)+"/update-status",JSONObject().put("release_id",release?.optString("id") ?: JSONObject.NULL).put("stage",stage).put("app_version_code",version(context)).put("message",message.take(300))) } catch (_:Exception) { }
    }
    @Synchronized fun checkAndDownload(context:Context) {
        reconcileInstalledState(context)
        val config=ConfigStore(context)
        if(config.deviceToken.isBlank())return
        val result=DeviceApi.request(config,DeviceApi.devicePath(config)+"/release?version_code=${version(context)}")
        config.lastUpdateCheck=System.currentTimeMillis()
        if(!result.optBoolean("available")) { clearPending(context); return }
        val release=result.getJSONObject("release")
        val releaseCode=release.getLong("version_code")
        if (!UpdateDecision.needsUpdate(version(context), releaseCode)) {
            clearPending(context)
            return
        }
        require(release.getString("package_name") == context.packageName) {
            "Wrong app package in update metadata"
        }
        val existing=pendingRelease(context)
        if (existing != null && existing.optString("id") != release.getString("id")) {
            clearPending(context)
        }
        try {
            val target=file(context)
            if(target.exists()) {
                try {
                    verify(context,target,release)
                    config.availableRelease=release.toString()
                    report(config,context,release,"AWAITING_INSTALL")
                    return
                } catch(_:Exception) {target.delete()}
            }
            report(config,context,release,"DOWNLOADING")
            val signed=DeviceApi.request(config,DeviceApi.devicePath(config)+"/releases/${release.getString("id")}/download").getString("url")
            require(URL(signed).protocol=="https") {"App download must use HTTPS"}
            val conn=(URL(signed).openConnection() as HttpURLConnection).apply {connectTimeout=12000;readTimeout=30000;instanceFollowRedirects=false}
            val part=File(target.parentFile,"download.part")
            try {
                check(conn.responseCode==200) {"App download failed"}
                var count=0L
                conn.inputStream.use { input -> part.outputStream().use { output ->
                    val buffer=ByteArray(64*1024)
                    while(true) {val n=input.read(buffer);if(n<0)break;count+=n;check(count<=LIMIT&&count<=release.getLong("size_bytes")){"APK exceeds expected size"};output.write(buffer,0,n)}
                } }
                verify(context,part,release)
                check(part.renameTo(target)) {"Cannot save verified update"}
            } finally {conn.disconnect();part.delete()}
            // Only mark ready after the entire APK has been verified and stored.
            config.availableRelease=release.toString()
            report(config,context,release,"AWAITING_INSTALL")
            notifyReady(context)
        } catch(e:Exception) {
            if (!UpdateDecision.needsUpdate(version(context), releaseCode)) {
                clearPending(context)
                return
            }
            report(config,context,release,"FAILED",e.message ?: "Update failed")
            throw e
        }
    }
    @Suppress("DEPRECATION") fun verify(context:Context, apk:File, release:JSONObject) {
        check(release.getString("package_name")==context.packageName) {"Wrong app package"}
        check(apk.length()==release.getLong("size_bytes")&&apk.length()<=LIMIT) {"Incomplete APK"}
        val sha=MessageDigest.getInstance("SHA-256")
        apk.inputStream().use {input->val b=ByteArray(65536);while(true){val n=input.read(b);if(n<0)break;sha.update(b,0,n)}}
        check(sha.digest().joinToString(""){"%02x".format(it)}==release.getString("sha256")) {"APK checksum mismatch"}
        val flags=if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val candidate=context.packageManager.getPackageArchiveInfo(apk.absolutePath,flags) ?: error("Invalid APK")
        val installed=context.packageManager.getPackageInfo(context.packageName,flags)
        check(candidate.packageName==context.packageName&&code(candidate)==release.getLong("version_code")&&code(candidate)>code(installed)) {"Wrong or older app version"}
        fun signatures(info:PackageInfo):Set<String> {
            val values=if(Build.VERSION.SDK_INT>=28)info.signingInfo?.apkContentsSigners else info.signatures
            return values.orEmpty().map{MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString(""){b->"%02x".format(b)}}.toSet()
        }
        check(signatures(candidate).isNotEmpty()&&signatures(candidate)==signatures(installed)) {"APK signing key does not match installed Fireblade"}
    }
    fun install(context:Context) {
        val config=ConfigStore(context)
        val release=JSONObject(config.availableRelease)
        if(!context.packageManager.canRequestPackageInstalls()) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        }
        val uri=FileProvider.getUriForFile(context,"${context.packageName}.updates",file(context))
        context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    private fun notifyReady(context:Context) {
        if(Build.VERSION.SDK_INT>=33&&ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return
        val manager=context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("fireblade_updates","Fireblade updates",NotificationManager.IMPORTANCE_DEFAULT))
        val action=PendingIntent.getActivity(context,0,Intent(context,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        manager.notify(36,NotificationCompat.Builder(context,"fireblade_updates").setSmallIcon(R.drawable.ic_notification_fireblade).setContentTitle("Fireblade update ready").setContentText("Open Fireblade to install the update").setContentIntent(action).setAutoCancel(true).build())
    }
}
