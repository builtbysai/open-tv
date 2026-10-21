package com.builtbysai.opentv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/** Starts the receiver screen after boot, then stops itself. It holds no connection of its own. */
public final class StartService extends Service {
    private static final String CHANNEL = "start";

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Starting Open TV", NotificationManager.IMPORTANCE_LOW));
        Notification notice = new Notification.Builder(this, CHANNEL)
            .setContentTitle("Open TV").setContentText("Getting ready for your phone")
            .setSmallIcon(R.drawable.app_icon).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, notice);
        try {
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
        } catch (RuntimeException ignored) {
            // Some builds still refuse a launch from the background; the app opens on next use.
        }
        new Handler(Looper.getMainLooper()).postDelayed(() -> { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); }, 5000);
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
