import java.util.Properties
import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

val signingNames = listOf("TIDEPLAN_KEYSTORE_PATH", "TIDEPLAN_KEYSTORE_PASSWORD", "TIDEPLAN_KEY_ALIAS", "TIDEPLAN_KEY_PASSWORD")
val hasReleaseSigning = signingNames.all { !System.getenv(it).isNullOrBlank() }
val oceanseoAndroidProduct = providers.gradleProperty("oceanseoAndroidProduct").orElse("personal").get()
require(oceanseoAndroidProduct == "personal") { "Unknown Android product" }
require((System.getenv("OCEANSEO_ANDROID_PRODUCT") ?: "personal") == oceanseoAndroidProduct) { "Android Gradle/native product mismatch" }
val oceanseoManifest = JsonSlurper().parse(rootProject.file("../../android-products.json")) as Map<*, *>
require(oceanseoManifest["version"] == 1 && oceanseoManifest["jniNamespace"] == "com.tideplan.mobile")
val oceanseoProducts = oceanseoManifest["products"] as Map<*, *>
val oceanseoProduct = oceanseoProducts[oceanseoAndroidProduct] as Map<*, *>
val oceanseoApplicationId = oceanseoProduct["applicationId"] as String
require(oceanseoApplicationId == "com.tideplan.mobile")

android {
    compileSdk = 36
    ndkVersion = "28.2.13676358"
    namespace = "com.tideplan.mobile"
    if (hasReleaseSigning) {
        signingConfigs.create("distribution") {
            storeFile = file(System.getenv("TIDEPLAN_KEYSTORE_PATH"))
            storePassword = System.getenv("TIDEPLAN_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("TIDEPLAN_KEY_ALIAS")
            keyPassword = System.getenv("TIDEPLAN_KEY_PASSWORD")
        }
    }
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.tideplan.mobile"
        minSdk = 28
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            val internalSuffix = providers.gradleProperty("tideplanInternalSuffix").orElse(".debug").get()
            require(internalSuffix in listOf(".debug", ".syncqa", ".infraqa", ".uiuxqa"))
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-internal"
            resValue("string", "app_name", when (internalSuffix) {
                ".syncqa" -> "Oceanseo · 同步验收"
                ".infraqa" -> "Oceanseo · 主机验收"
                ".uiuxqa" -> "Oceanseo · 界面验收"
                else -> "Oceanseo · 内测"
            })
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            // Internal UI testing needs WebView debugging, not 160 MB of native
            // debug symbols. Symbols remain in src-tauri/target for local work.
            isJniDebuggable = false
            isMinifyEnabled = false
        }
        getByName("release") {
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("distribution")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

// Tauri rewrites applicationIdSuffix during builds. Apply the QA override
// after DSL configuration so a test installation never targets daily data.
androidComponents {
    finalizeDsl { extension ->
        val suffix = providers.gradleProperty("tideplanInternalSuffix").orElse(".debug").get()
        require(suffix in listOf(".debug", ".syncqa", ".infraqa", ".uiuxqa"))
        require(extension.namespace == "com.tideplan.mobile") { "Shared Kotlin/JNI namespace must stay stable" }
        extension.defaultConfig.applicationId = oceanseoApplicationId
        extension.buildTypes.getByName("debug").applicationIdSuffix = suffix
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
