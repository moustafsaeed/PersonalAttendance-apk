package com.personal.attendance.receivers;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import com.personal.attendance.notifications.NotificationScheduler;

public class TimeChangeReceiver extends BroadcastReceiver {
    private static final String TAG = "TIME_CHANGE_RECEIVER";

    @Override
    public void onReceive(Context context, Intent receivedIntent) {
        String action = receivedIntent.getAction();
        if (Intent.ACTION_TIME_CHANGED.equals(action) || 
            Intent.ACTION_TIMEZONE_CHANGED.equals(action) || 
            Intent.ACTION_DATE_CHANGED.equals(action)) {
            Log.d(TAG, "Time/Timezone changed, rescheduling...");
            NotificationScheduler.rescheduleAll(context);
        }
    }
}
