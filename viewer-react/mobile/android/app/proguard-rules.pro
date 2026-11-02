# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Capacitor's JavaScript side calls these methods by name through WebView.addJavascriptInterface
# (MessageHandler.postMessage, and the plugin flags in CapacitorHttp and CapacitorCookies).
# R8 cannot see those calls, so without this rule it removes or renames them and the bridge breaks.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Capacitor finds plugins and their annotations by reflection, so the annotation attributes must
# survive shrinking (the consumer rules keep the annotation types themselves).
-keepattributes *Annotation*
