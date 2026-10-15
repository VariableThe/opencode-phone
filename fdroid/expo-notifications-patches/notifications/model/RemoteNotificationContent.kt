package expo.modules.notifications.notifications.model

import android.content.Context
import android.graphics.Bitmap
import android.os.Parcel
import android.os.Parcelable
import expo.modules.notifications.notifications.enums.NotificationPriority
import expo.modules.notifications.notifications.interfaces.INotificationContent
import org.json.JSONObject

/**
 * Stub RemoteNotificationContent (Firebase-free) for F-Droid builds.
 * This class exists only for compile compatibility. It is never instantiated
 * since no FCM messages are received without the Firebase SDK.
 */
class RemoteNotificationContent private constructor() : INotificationContent, Parcelable {
  /** Always false — no data-only remote notifications without FCM. */
  val isDataOnly = false

  override val title: String? = null
  override val text: String? = null
  override val shouldPlayDefaultSound = false
  override val soundName: String? = null
  override val shouldUseDefaultVibrationPattern = false
  override val vibrationPattern: LongArray? = null
  override val body: JSONObject? = null
  override val priority: NotificationPriority = NotificationPriority.DEFAULT
  override val color: Number? = null
  override val isAutoDismiss = true
  override val categoryId: String? = null
  override val isSticky = false
  override val subText: String? = null
  override val badgeCount: Number? = null
  override suspend fun getImage(context: Context): Bitmap? = null
  override fun containsImage() = false
  override fun describeContents() = 0
  override fun writeToParcel(dest: Parcel, flags: Int) {}

  companion object CREATOR : Parcelable.Creator<RemoteNotificationContent> {
    override fun createFromParcel(parcel: Parcel) = RemoteNotificationContent()
    override fun newArray(size: Int) = arrayOfNulls<RemoteNotificationContent>(size)
  }
}
