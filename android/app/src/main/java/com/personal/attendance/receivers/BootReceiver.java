package com.personal.attendance.receivers;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
// سنقوم لاحقاً بإضافة AlarmScheduler هنا

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BOOT_RECEIVER";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.d(TAG, "Device booted, rescheduling alarms...");
            NotificationScheduler.rescheduleAll(context);
        }
    }
}
