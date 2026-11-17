package com.anko.rfid.ankowms;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class ApplicationBroadcastReceiver extends BroadcastReceiver {
    private static final String TAG = "AppBroadcastReceiver";
    public static boolean wasScreenOn = true;
    private MainActivity activity;
    public ApplicationBroadcastReceiver(MainActivity _activity) {
        activity = _activity;
    }
    @Override
    public void onReceive(Context context, Intent intent) {
        final String action = intent.getAction();
        Log.d(TAG, "onReceive");
        if (intent.getAction().equals(Intent.ACTION_SCREEN_OFF)) {
            // DO WHATEVER YOU NEED TO DO HERE
            wasScreenOn = false;
        } else if (intent.getAction().equals(Intent.ACTION_SCREEN_ON)) {
            // AND DO WHATEVER YOU NEED TO DO HERE
            wasScreenOn = true;
        }
        if (action.equals(BluetoothAdapter.ACTION_STATE_CHANGED)) {
            final int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
            switch(state) {
                case BluetoothAdapter.STATE_OFF:
                    activity.playBTDisconnectedSound();
                    break;
                case BluetoothAdapter.STATE_TURNING_OFF:
                    break;
                case BluetoothAdapter.STATE_ON:
                    activity.playBTConnectSound();
                    break;
                case BluetoothAdapter.STATE_TURNING_ON:
                    break;
            }
        }
        if (action.equals(BluetoothDevice.ACTION_FOUND)) {
            BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            
            activity.foundBTDevice(device);
        }
        if (action.equals(BluetoothAdapter.ACTION_DISCOVERY_STARTED)) {
            Log.d(TAG, "Bluetooth Discovery Started");
            activity.discoveryOfBTStarted();
        }
        if (action.equals(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)) {
            Log.d(TAG, "Bluetooth Discovery Finished");
            activity.discoveryOfBTEnded();
        }
        if (action.equals(BluetoothDevice.ACTION_BOND_STATE_CHANGED)) {
            final int state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.ERROR);
            BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            switch (state) {
                case BluetoothDevice.BOND_BONDED:
                    // send notification that new device has been bonded
                    activity.bondedWithSuccess(device);
                    break;
                case BluetoothDevice.BOND_BONDING:
                    activity.deviceBondingInProgress(device);
                    break;
                case BluetoothDevice.BOND_NONE:
                    // lets us know what the device has been
                    // unpaired. Deal with logic accordingly
                    activity.unpairedWithSuccess(device);
                    break;
            }
        }
    }

}
