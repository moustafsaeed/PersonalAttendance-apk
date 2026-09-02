package com.personal.attendance;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String CHANNEL_ID = "attendance_reminders";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeExportPlugin.class);
        registerPlugin(AttendancePlugin.class);
        androidx.core.splashscreen.SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        createNotificationChannel();
        injectBridge();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "تنبيهات الدوام",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("تنبيهات مواعيد الحضور والانصراف");
            channel.enableVibration(true);
            channel.enableLights(true);
            channel.setShowBadge(true);
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void injectBridge() {
        // Inject native bridge for Xiaomi-specific settings
        try {
            getBridge().getWebView().addJavascriptInterface(new Object() {

                @JavascriptInterface
                public boolean isBatteryOptimized() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                        return pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName());
                    }
                    return false;
                }

                @JavascriptInterface
                public void openBatterySettings() {
                    try {
                        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(Uri.parse("package:" + getPackageName()));
                        startActivity(intent);
                    } catch (Exception e) {
                        // Fallback to general battery settings
                        try {
                            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                            startActivity(intent);
                        } catch (Exception ex) {
                            ex.printStackTrace();
                        }
                    }
                }

                @JavascriptInterface
                public void openAutoStartSettings() {
                    String manufacturer = Build.MANUFACTURER.toLowerCase();
                    Intent intent = new Intent();
                    try {
                        if (manufacturer.contains("xiaomi") || manufacturer.contains("redmi")) {
                            intent.setAction("miui.intent.action.OP_AUTO_START");
                            intent.addCategory(Intent.CATEGORY_DEFAULT);
                        } else if (manufacturer.contains("huawei") || manufacturer.contains("honor")) {
                            intent.setClassName("com.huawei.systemmanager",
                                "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity");
                        } else if (manufacturer.contains("oppo") || manufacturer.contains("realme")) {
                            intent.setClassName("com.coloros.safecenter",
                                "com.coloros.safecenter.startupapp.StartupAppListActivity");
                        } else if (manufacturer.contains("vivo")) {
                            intent.setClassName("com.iqoo.secure",
                                "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity");
                        } else if (manufacturer.contains("samsung")) {
                            intent.setClassName("com.samsung.android.lool",
                                "com.samsung.android.sm.battery.ui.BatteryActivity");
                        } else {
                            intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                            intent.setData(Uri.parse("package:" + getPackageName()));
                        }
                        startActivity(intent);
                    } catch (Exception e) {
                        // Fallback: open app info settings
                        try {
                            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                            intent.setData(Uri.parse("package:" + getPackageName()));
                            startActivity(intent);
                        } catch (Exception ex) {
                            ex.printStackTrace();
                        }
                    }
                }

                @JavascriptInterface
                public String getDeviceManufacturer() {
                    return Build.MANUFACTURER;
                }

                @JavascriptInterface
                public int getAndroidVersion() {
                    return Build.VERSION.SDK_INT;
                }

            }, "NativeBridge");
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
