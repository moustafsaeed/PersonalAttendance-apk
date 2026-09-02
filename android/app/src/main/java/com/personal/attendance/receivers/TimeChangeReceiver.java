package com.personal.attendance.receivers;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import com.personal.attendance.notifications.NotificationScheduler;

import static android.content.Intent.ACTION_TIME_SET;
import static android.content.Intent.ACTION_TIMEZONE_CHANGED;
import static android.content.Intent.ACTION_DATE_CHANGED;

public class TimeChangeReceiver extends BroadcastReceiver {
    private static final String TAG = "TIME_CHANGE_RECEIVER";

    @Override
    public void onReceive(Context context, Intent receivedIntent) {
        String action = receivedIntent.getAction();
        if (ACTION_TIME_SET.equals(action) || 
            ACTION_TIMEZONE_CHANGED.equals(action) || 
            ACTION_DATE_CHANGED.equals(action)) {
            Log.d(TAG, "Time/Timezone changed, rescheduling...");
            NotificationScheduler.rescheduleAll(context);
        }
    }
}
