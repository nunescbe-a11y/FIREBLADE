import java.util.Properties
import java.security.KeyStore
import java.security.MessageDigest

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")

android {
    namespace = "com.nunes.callcollector"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.nunes.callcollector"
        minSdk = 26
        targetSdk = 36
        versionCode = 38
        versionName = "1.7.23"
    }

    buildFeatures { viewBinding = true }
    signingConfigs {
        create("existingIdentity") {
            val props = Properties()
            val propsFile = rootProject.file("signing.properties")
            if (propsFile.exists()) propsFile.inputStream().use { props.load(it) }
            storeFile = file(props.getProperty("storeFile") ?: System.getenv("FIREBLADE_KEYSTORE") ?: "${System.getProperty("user.home")}/.android/debug.keystore")
            storePassword = props.getProperty("storePassword") ?: System.getenv("FIREBLADE_STORE_PASSWORD") ?: "android"
            keyAlias = props.getProperty("keyAlias") ?: System.getenv("FIREBLADE_KEY_ALIAS") ?: "androiddebugkey"
            keyPassword = props.getProperty("keyPassword") ?: System.getenv("FIREBLADE_KEY_PASSWORD") ?: "android"
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("existingIdentity")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("com.google.firebase:firebase-messaging:24.1.2")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.google.android.material:material:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.2")

    val roomVersion = "2.7.2"
    implementation("androidx.room:room-runtime:$roomVersion")
    implementation("androidx.room:room-ktx:$roomVersion")
    ksp("androidx.room:room-compiler:$roomVersion")

    implementation("androidx.work:work-runtime-ktx:2.10.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
}

// Never substitute a new key: Android would reject the update or require uninstalling.
val verifyOriginalIdentity by tasks.registering {
    doLast {
        val signing = android.signingConfigs.getByName("existingIdentity")
        val keystore = signing.storeFile ?: error("Original keystore not configured")
        check(keystore.exists()) { "Original signing key missing. Use the same PC/key that built the installed Fireblade app." }
        val ks = KeyStore.getInstance(KeyStore.getDefaultType())
        keystore.inputStream().use { ks.load(it, signing.storePassword!!.toCharArray()) }
        val cert = ks.getCertificate(signing.keyAlias) ?: error("Signing alias not found")
        val hash = MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") { "%02x".format(it) }
        check(hash == "35890540b4a0ed76048dd02a5eaabf638eaecef6969cf91ec20b73c9816061f7") {
            "Signing identity mismatch. Do not uninstall working phones. Configure the original keystore."
        }
    }
}
tasks.matching { it.name == "preReleaseBuild" || it.name == "validateSigningRelease" }.configureEach { dependsOn(verifyOriginalIdentity) }
