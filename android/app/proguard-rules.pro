-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

-keep class com.personal.attendance.** { *; }
-keep class com.getcapacitor.** { *; }

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keepclassmembers class com.personal.attendance.MainActivity {
    public *;
}

-dontwarn com.capacitorjs.**
-dontwarn android.webkit.**

# Google Sign-In & Auth
-keep class com.google.android.gms.** { *; }
-keep class com.google.android.gms.auth.** { *; }
-keep class com.google.android.gms.common.** { *; }
-keep class com.google.android.gms.tasks.** { *; }
-dontwarn com.google.android.gms.**

# Capacitor Google Auth Plugin
-keep class com.codetrixstudio.capacitor.GoogleAuth.** { *; }
-dontwarn com.codetrixstudio.capacitor.GoogleAuth.**

# Keep Google API client classes
-keep class com.google.api.** { *; }
-dontwarn com.google.api.**

# Prevent R8 from failing compilation due to third-party warnings
-ignorewarnings
-keep class com.capgo.** { *; }
-dontwarn com.capgo.**
