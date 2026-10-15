package expo.modules.notifications.notifications;

import static expo.modules.notifications.UtilsKt.filteredBundleForJSTypeConverter;
import static expo.modules.notifications.UtilsKt.isValidJSONString;
import static expo.modules.notifications.notifications.model.NotificationResponse.DEFAULT_ACTION_IDENTIFIER;

import android.os.Bundle;

import androidx.annotation.Nullable;

import org.jetbrains.annotations.NotNull;
import org.json.JSONArray;
import org.json.JSONObject;
import expo.modules.core.arguments.MapArguments;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

import expo.modules.notifications.notifications.interfaces.INotificationContent;
import expo.modules.notifications.notifications.interfaces.NotificationTrigger;
import expo.modules.notifications.notifications.interfaces.SchedulableNotificationTrigger;
import expo.modules.notifications.notifications.model.Notification;
import expo.modules.notifications.notifications.model.NotificationRequest;
import expo.modules.notifications.notifications.model.NotificationResponse;
import expo.modules.notifications.notifications.model.TextInputNotificationResponse;
import expo.modules.notifications.notifications.triggers.ChannelAwareTrigger;

/**
 * Patched version (Firebase-free) for F-Droid builds.
 * Removed: FirebaseNotificationTrigger and RemoteMessage references.
 */
public class NotificationSerializer {
  public static Bundle toBundle(NotificationResponse response) {
    Bundle serializedResponse = new Bundle();
    serializedResponse.putString("actionIdentifier", response.getActionIdentifier());
    serializedResponse.putBundle("notification", toBundle(response.getNotification()));
    if (response instanceof TextInputNotificationResponse) {
      serializedResponse.putString("userText", ((TextInputNotificationResponse) response).getUserText());
    }
    return serializedResponse;
  }

  public static Bundle toBundle(Notification notification) {
    Bundle serializedNotification = new Bundle();
    serializedNotification.putBundle("request", toBundle(notification.getNotificationRequest()));
    serializedNotification.putLong("date", notification.getOriginDate().getTime());
    return serializedNotification;
  }

  public static Bundle toBundle(NotificationRequest request) {
    Bundle serializedRequest = new Bundle();
    serializedRequest.putString("identifier", request.getIdentifier());
    NotificationTrigger requestTrigger = request.getTrigger();
    serializedRequest.putBundle("trigger", requestTrigger == null ? null : requestTrigger.toBundle());
    Bundle content = toBundle(request.getContent());
    Bundle existingContentData = content.getBundle("data");
    if (existingContentData == null) {
      if (requestTrigger instanceof SchedulableNotificationTrigger ||
          requestTrigger instanceof ChannelAwareTrigger ||
          requestTrigger == null) {
        JSONObject body = request.getContent().getBody();
        if (body != null) {
          content.putString("dataString", body.toString());
        }
      }
    }
    serializedRequest.putBundle("content", content);
    return serializedRequest;
  }

  public static Bundle toBundle(Map<String, String> map) {
    Bundle result = new Bundle();
    for (String key: map.keySet()) {
      result.putString(key, map.get(key));
    }
    return result;
  }

  public static Bundle toBundle(INotificationContent content) {
    Bundle serializedContent = new Bundle();
    serializedContent.putString("title", content.getTitle());
    serializedContent.putString("subtitle", content.getSubText());
    serializedContent.putString("body", content.getText());
    if (content.getColor() != null) {
      serializedContent.putString("color", String.format("#%08X", content.getColor().intValue()));
    }

    if (content.getBadgeCount() != null) {
      serializedContent.putInt("badge", content.getBadgeCount().intValue());
    } else {
      serializedContent.putString("badge", null);
    }
    if (content.getShouldPlayDefaultSound()) {
      serializedContent.putString("sound", "default");
    } else if (content.getSoundName() != null) {
      serializedContent.putString("sound", "custom");
    } else {
      serializedContent.putString("sound", null);
    }
    if (content.getPriority() != null) {
      serializedContent.putString("priority", content.getPriority().getEnumValue());
    }
    if (content.getVibrationPattern() != null) {
      serializedContent.putLongArray("vibrationPattern", content.getVibrationPattern());
    }
    serializedContent.putBoolean("autoDismiss", content.isAutoDismiss());
    if (content.getCategoryId() != null) {
      serializedContent.putString("categoryIdentifier", content.getCategoryId());
    }
    serializedContent.putBoolean("sticky", content.isSticky());
    return serializedContent;
  }

  public static Bundle toBundle(@Nullable JSONObject notification) {
    if (notification == null) {
      return null;
    }
    Map<String, Object> notificationMap = new HashMap<>(notification.length());
    Iterator<String> keyIterator = notification.keys();
    while (keyIterator.hasNext()) {
      String key = keyIterator.next();
      Object value = notification.opt(key);
      if (value instanceof JSONObject) {
        notificationMap.put(key, toBundle((JSONObject) value));
      } else if (value instanceof JSONArray) {
        notificationMap.put(key, toList((JSONArray) value));
      } else if (JSONObject.NULL.equals(value)) {
        notificationMap.put(key, null);
      } else {
        notificationMap.put(key, value);
      }
    }
    try {
      return new MapArguments(notificationMap).toBundle();
    } catch (NullPointerException e) {
      Set<String> keySet = notificationMap.keySet();
      for (String key : keySet) {
        if (notificationMap.get(key) == null) {
          notificationMap.remove(key);
        }
      }
      return new MapArguments(notificationMap).toBundle();
    }
  }

  private static List<Object> toList(JSONArray array) {
    List<Object> result = new ArrayList<>(array.length());
    for (int i = 0; i < array.length(); i++) {
      if (array.isNull(i)) {
        result.add(null);
      } else if (array.optJSONObject(i) != null) {
        result.add(toBundle(array.optJSONObject(i)));
      } else if (array.optJSONArray(i) != null) {
        result.add(toList(array.optJSONArray(i)));
      } else {
        result.add(array.opt(i));
      }
    }
    return result;
  }

  @NotNull
  public static Bundle toResponseBundleFromExtras(Bundle extras) {
    Bundle serializedContent = new Bundle();
    serializedContent.putString("title", extras.getString("title"));
    String body = extras.getString("body");
    if (isValidJSONString(body)) {
      serializedContent.putString("dataString", body);
      serializedContent.putString("body", extras.getString("message"));
    } else {
      serializedContent.putBundle("data", filteredBundleForJSTypeConverter(extras));
    }

    Bundle serializedTrigger = new Bundle();
    serializedTrigger.putString("type", "push");
    serializedTrigger.putString("channelId", extras.getString("channelId"));

    Bundle serializedRequest = new Bundle();
    serializedRequest.putString("identifier", extras.getString("google.message_id"));
    serializedRequest.putBundle("trigger", serializedTrigger);
    serializedRequest.putBundle("content", serializedContent);

    Bundle serializedNotification = new Bundle();
    serializedNotification.putLong("date", extras.getLong("google.sent_time"));
    serializedNotification.putBundle("request", serializedRequest);

    Bundle serializedResponse = new Bundle();
    serializedResponse.putString("actionIdentifier", DEFAULT_ACTION_IDENTIFIER);
    serializedResponse.putBundle("notification", serializedNotification);

    return serializedResponse;
  }
}
