package com.personal.attendance;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.personal.attendance.notifications.NotificationHelper;
import com.personal.attendance.notifications.NotificationScheduler;
import org.json.JSONObject;

@CapacitorPlugin(name = "AttendanceNotification")
public class AttendancePlugin extends Plugin {

    @Override
    public void load() {
        NotificationHelper.createNotificationChannel(getContext());
    }

    @PluginMethod
    public void scheduleAttendanceNotification(PluginCall call) {
        try {
            JSONObject schedule = call.getData().getJSONObject("schedule");
            NotificationScheduler.scheduleAlarm(getContext(), schedule);
            call.resolve();
        } catch (Exception e) {
            call.reject("Error scheduling alarm", e);
        }
    }
    
    // Additional methods (cancel, check permissions) would go here
}
