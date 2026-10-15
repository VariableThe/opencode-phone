package expo.modules.application

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Patched ApplicationModule (installreferrer-free) for F-Droid builds.
 * Removed: com.android.installreferrer dependency (Google Play-only API).
 * getInstallReferrerAsync rejects with an error in F-Droid builds.
 */

class ApplicationPackageNameNotFoundException(cause: PackageManager.NameNotFoundException) :
  CodedException(message = "Unable to get install time of this application. Could not get package info or package name.", cause = cause)

class ApplicationModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ExpoApplication")

    Constant("applicationName") {
      context.applicationInfo.loadLabel(context.packageManager).toString()
    }

    Constant("applicationId") {
      packageName
    }

    Constant("nativeApplicationVersion") {
      packageManager.getPackageInfoCompat(packageName, 0).versionName
    }

    Constant("nativeBuildVersion") {
      getLongVersionCode(packageManager.getPackageInfoCompat(packageName, 0)).toInt().toString()
    }

    Constant("androidId") {
      Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
    }

    AsyncFunction<Double>("getInstallationTimeAsync") {
      val packageManager = context.packageManager
      val packageName = context.packageName
      packageManager
        .getPackageInfoCompat(packageName, 0)
        .firstInstallTime
        .toDouble()
    }

    AsyncFunction<Double>("getLastUpdateTimeAsync") {
      val packageManager = context.packageManager
      val packageName = context.packageName
      packageManager
        .getPackageInfoCompat(packageName, 0)
        .lastUpdateTime
        .toDouble()
    }

    AsyncFunction("getInstallReferrerAsync") { promise: Promise ->
      // Install referrer API requires Google Play Services and is unavailable in F-Droid builds.
      promise.reject(
        "ERR_APPLICATION_INSTALL_REFERRER_UNAVAILABLE",
        "Install referrer is not available in F-Droid builds (no Google Play Services).",
        null
      )
    }
  }

  private val packageName
    get() = context.packageName
  private val packageManager
    get() = context.packageManager
}

private fun PackageManager.getPackageInfoCompat(packageName: String, flags: Int = 0): PackageInfo =
  try {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(flags.toLong()))
    } else {
      @Suppress("DEPRECATION")
      getPackageInfo(packageName, flags)
    }
  } catch (e: PackageManager.NameNotFoundException) {
    throw ApplicationPackageNameNotFoundException(e)
  }

private fun getLongVersionCode(info: PackageInfo): Long {
  return if (Build.VERSION.SDK_INT >= 28) {
    info.longVersionCode
  } else {
    @Suppress("DEPRECATION")
    info.versionCode.toLong()
  }
}
