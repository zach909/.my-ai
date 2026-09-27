plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ai.neuroclaw.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "ai.neuroclaw.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    // OneBrain ships inside the app so it can answer offline: the same
    // models && skills/onebrain/model.json the PC loads, copied in at build.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/onebrain-assets"))
}

val copyOneBrain by tasks.registering(Copy::class) {
    from(rootProject.file("../../models && skills/onebrain/model.json"))
    into(layout.buildDirectory.dir("generated/onebrain-assets/onebrain"))
}
tasks.named("preBuild") { dependsOn(copyOneBrain) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
}
