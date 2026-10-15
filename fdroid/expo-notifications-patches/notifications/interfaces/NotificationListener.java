package expo.modules.notifications.notifications.interfaces;

import android.os.Bundle;

import expo.modules.notifications.notifications.model.Notification;
import expo.modules.notifications.notifications.model.NotificationResponse;

/**
 * Patched version (Firebase-free) for F-Droid builds.
 * Removed: import com.google.firebase.messaging.FirebaseMessagingService (only used in javadoc).
 */
public interface NotificationListener {
  /**
   * Callback called when new notification is received while the app is in foreground.
   */
  default void onNotificationReceived(Notification notification) {
  }

  /**
   * Callback called when new notification response is received.
   */
  default boolean onNotificationResponseReceived(NotificationResponse response) {
    return false;
  }

  /**
   * Callback called when notification response is received through package lifecycle listeners.
   */
  default void onNotificationResponseIntentReceived(Bundle extras) {
  }

  /**
   * Callback called when some notifications are dropped.
   */
  default void onNotificationsDropped() {
  }
}
