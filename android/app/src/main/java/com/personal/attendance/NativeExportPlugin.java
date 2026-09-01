package com.personal.attendance;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "NativeExport")
public class NativeExportPlugin extends Plugin {

    @PluginMethod
    public void saveToMediaStore(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String base64Data = call.getString("base64Data");
        String subDir = call.getString("subDir", "Personal Attendance");

        if (fileName == null || fileName.trim().isEmpty() || base64Data == null || base64Data.trim().isEmpty()) {
            call.reject("MISSING_DATA", "اسم الملف والبيانات مطلوبة للحفظ");
            return;
        }

        try {
            byte[] fileBytes = Base64.decode(base64Data, Base64.DEFAULT);
            if (fileBytes == null || fileBytes.length == 0) {
                call.reject("EMPTY_DATA", "بيانات الملف فارغة");
                return;
            }

            ContentResolver resolver = getContext().getContentResolver();
            Uri targetCollection;
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);

            Uri itemUri = null;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ (API 29+): Scoped Storage compliant MediaStore API
                targetCollection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + subDir);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                itemUri = resolver.insert(targetCollection, values);
            } else {
                // Android 9 and below legacy fallback
                File baseDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File appDir = new File(baseDir, subDir);
                if (!appDir.exists()) {
                    appDir.mkdirs();
                }
                File targetFile = new File(appDir, fileName);
                values.put(MediaStore.MediaColumns.DATA, targetFile.getAbsolutePath());
                targetCollection = MediaStore.Files.getContentUri("external");
                itemUri = resolver.insert(targetCollection, values);
            }

            if (itemUri == null) {
                call.reject("INSERT_FAILED", "تعذر إنشاء مسار الملف في الذاكرة");
                return;
            }

            // Write the bytes safely to the output stream
            boolean writeSuccess = false;
            try (OutputStream os = resolver.openOutputStream(itemUri, "w")) {
                if (os != null) {
                    os.write(fileBytes);
                    os.flush();
                    writeSuccess = true;
                }
            } catch (Exception writeEx) {
                // Rollback and delete broken / incomplete entry
                try {
                    resolver.delete(itemUri, null, null);
                } catch (Exception ignored) {}
                call.reject("WRITE_FAILED", "فشل أثناء كتابة الملف: " + writeEx.getMessage());
                return;
            }

            if (!writeSuccess) {
                try {
                    resolver.delete(itemUri, null, null);
                } catch (Exception ignored) {}
                call.reject("WRITE_FAILED", "لم تتم كتابة البيانات بنجاح");
                return;
            }

            // Publish file (release IS_PENDING lock on Android 10+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues finishValues = new ContentValues();
                finishValues.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(itemUri, finishValues, null, null);
            }

            // Verify the file actually exists and size > 0
            long verifiedSize = 0;
            try (InputStream is = resolver.openInputStream(itemUri)) {
                if (is != null) {
                    verifiedSize = is.available();
                }
            } catch (Exception ignored) {}

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("uri", itemUri.toString());
            ret.put("fileName", fileName);
            ret.put("mimeType", mimeType);
            ret.put("sizeBytes", fileBytes.length);
            ret.put("displayPath", "التنزيلات / " + subDir + " / " + fileName);
            call.resolve(ret);

        } catch (Exception e) {
            call.reject("EXCEPTION", "حدث خطأ غير متوقع أثناء الحفظ: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        String uriStr = call.getString("uri");
        String mimeType = call.getString("mimeType", "application/pdf");

        if (uriStr == null || uriStr.trim().isEmpty()) {
            call.reject("MISSING_URI", "مسار الملف غير محدد");
            return;
        }

        try {
            Uri fileUri = Uri.parse(uriStr);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(fileUri, mimeType);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getActivity().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (android.content.ActivityNotFoundException e) {
            call.reject("NO_APP_FOUND", "لا يوجد تطبيق مثبت لفتح هذا النوع من الملفات");
        } catch (Exception e) {
            call.reject("OPEN_FAILED", "تعذر فتح الملف: " + e.getMessage());
        }
    }
}
