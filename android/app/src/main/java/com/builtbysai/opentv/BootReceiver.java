package com.builtbysai.opentv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Brings Open TV back after the TV restarts, so paired phones see it again without re-pairing. */
public final class BootReceiver extends BroadcastReceiver {
    static final String PREFS = "opentv", AUTOSTART = "autostart";

    @Override public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        if (!context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(AUTOSTART, true)) return;
        // Android 10+ does not let a receiver open an activity directly; a short foreground
        // service does it and then stops.
        context.startForegroundService(new Intent(context, StartService.class));
    }
}
