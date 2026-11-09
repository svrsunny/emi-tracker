# kotlinx.serialization: keep generated serializers for the snapshot model
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.emitracker.core.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.emitracker.core.**$$serializer { *; }
-keepclasseswithmembers class com.emitracker.core.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclassmembers class com.emitracker.app.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.emitracker.app.**$$serializer { *; }
