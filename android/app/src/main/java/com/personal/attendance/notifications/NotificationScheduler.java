package com.personal.attendance.notifications;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;
import com.personal.attendance.receivers.AlarmReceiver;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

public class NotificationScheduler {
    private static final String PREFS_NAME = "AttendancePrefs";
    private static final String SCHEDULES_KEY = "schedules";

    public static void rescheduleAll(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String json = prefs.getString(SCHEDULES_KEY, "[]");
        try {
            JSONArray array = new JSONArray(json);
            for(int i=0; i<array.length(); i++) {
                scheduleAlarm(context, array.getJSONObject(i));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static void scheduleAlarm(Context context, JSONObject schedule) throws Exception {
        String scheduleId = schedule.getString("scheduleId");
        int hour = schedule.getInt("hour");
        int minute = schedule.getInt("minute");
        int reminderMinutes = schedule.getInt("reminderMinutes");
        String type = schedule.getString("type");
        String title = schedule.getString("title");
        String message = schedule.getString("message");

        // Calculate reminder time
        Calendar calendar = Calendar.getInstance();
        calendar.set(Calendar.HOUR_OF_DAY, hour);
        calendar.set(Calendar.MINUTE, minute);
        calendar.set(Calendar.SECOND, 0);
        calendar.add(Calendar.MINUTE, -reminderMinutes);

        if (calendar.before(Calendar.getInstance())) {
            calendar.add(Calendar.DAY_OF_YEAR, 1);
        }

        int alarmId = (scheduleId + type).hashCode();

        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.putExtra("id", alarmId);
        intent.putExtra("scheduleId", scheduleId);
        intent.putExtra("type", type);
        intent.putExtra("title", title);
        intent.putExtra("message", message);

        PendingIntent pendingIntent = PendingIntent.getBroadcast(context, alarmId, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (alarmManager.canScheduleExactAlarms()) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, calendar.getTimeInMillis(), pendingIntent);
            } else {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, calendar.getTimeInMillis(), pendingIntent);
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, calendar.getTimeInMillis(), pendingIntent);
        } else {
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, calendar.getTimeInMillis(), pendingIntent);
        }
        
        saveScheduleToPrefs(context, schedule);
    }

    private static void saveScheduleToPrefs(Context context, JSONObject schedule) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String json = prefs.getString(SCHEDULES_KEY, "[]");
        try {
            JSONArray array = new JSONArray(json);
            boolean found = false;
            for(int i=0; i<array.length(); i++) {
                if(array.getJSONObject(i).getString("scheduleId").equals(schedule.getString("scheduleId"))) {
                    array.put(i, schedule);
                    found = true;
                    break;
                }
            }
            if(!found) array.put(schedule);
            prefs.edit().putString(SCHEDULES_KEY, array.toString()).apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
