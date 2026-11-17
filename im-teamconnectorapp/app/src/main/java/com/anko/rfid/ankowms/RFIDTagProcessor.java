package com.anko.rfid.ankowms;

import android.content.Context;

public class RFIDTagProcessor  {

    MainActivity activity;
    Context context;

    public RFIDTagProcessor(MainActivity _activity) {
        activity = _activity;
        context = _activity.getApplicationContext();
    }
}
