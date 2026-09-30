plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.ilses1.snake"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ilses1.snake"
        minSdk = 24          // Android 7.0：覆盖 WebGL2 + Web Audio 的稳妥下限
        targetSdk = 35
        versionCode = 2
        versionName = "1.0.1"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // 游戏资源已是最终形态，不做压缩，避免二次解码开销
    androidResources {
        noCompress += listOf("html", "js")
    }
}

dependencies {
    // 仅为 WebViewAssetLoader：让 assets 通过 https://appassets.androidplatform.net/ 提供，
    // 这是 ES module + importmap 能在 WebView 里正常加载的前提（file:// 会被 CORS 拦掉）。
    implementation("androidx.webkit:webkit:1.12.1")
}
