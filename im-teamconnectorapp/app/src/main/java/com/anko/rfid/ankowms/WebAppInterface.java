package com.anko.rfid.ankowms;


import android.content.Context;
import android.media.MediaPlayer;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

public class WebAppInterface {
    Context context;
    MainActivity activity;
    final String TAG = "WebAppInterface";
    WebAppInterface(MainActivity _activity) {
        activity = _activity;
        context = _activity.getApplicationContext();
    }

    @JavascriptInterface
    public void showToast(String toast) {
        Toast.makeText(context, toast, Toast.LENGTH_SHORT).show();
    }

    @JavascriptInterface
    public void sendMessage(String type, String config) {
        Log.d(TAG, type + ":" + config);
    }

    @JavascriptInterface
    public  boolean isRFIDReaderConnected() {
        return activity.isRFIDReaderConnected();
    }

    @JavascriptInterface
    public void connectRFIDReader() {
        activity.connectRFIDScanner();
    }

    @JavascriptInterface
    public void disconnectRFIDReader() {
        activity.disconnectRFIDScanner();
    }

    @JavascriptInterface
    public void changeRFIDReaderSettings(String jsonSTR) {

    }

    @JavascriptInterface
    public void searchBarcode(String barcode) {

    }

    @JavascriptInterface
    public void toggleProxy() {

    }

    @JavascriptInterface
    public  void disableProxy() {
        // activity.disableProxy();
    }

    @JavascriptInterface
    public void enableProxy() {
        //activity.enableProxy();
    }

    @JavascriptInterface
    public void toggleRFID() {

    }


    @JavascriptInterface
    public void enableRFIDMode() {
        activity.enableRFIDMode();
    }

    @JavascriptInterface
    public void disableRFIDMode() {
        activity.disableRFIDMode();
    }

    @JavascriptInterface
    public void performRFIDInventory() {
        activity.performRFIDInventory();
    }

    @JavascriptInterface
    public void enableHybridMode() {
        activity.enableHybridMode();
    }

    @JavascriptInterface
    public void cancelHybridMode() {
        activity.cancelHybridMode();
    }

    @JavascriptInterface
    public void enableSession() {
        activity.enableSession();
    }

    @JavascriptInterface
    public void disableSession() {
        activity.disableSession();
    }

    @JavascriptInterface
    public void stopRFIDInventory() {
        activity.stopRFIDInventory();
    }

    @JavascriptInterface
    public void rfidInTriggerMode() {
        activity.setRFIDInTriggerMode(true);
    }

    @JavascriptInterface
    public  void rfidInSoftwareMode() {
        activity.setRFIDInTriggerMode(false);
    }

    @JavascriptInterface
    public void rfidFromRFDTrigger() {
        activity.rfidFromRFDTrigger();
    }

    @JavascriptInterface
    public void barcodeFromRFDTrigger() {
        activity.barcodeFromRFDTrigger();
    }

    @JavascriptInterface
    public void successTone() {
        PlaySound(R.raw.scan);
    }

    @JavascriptInterface
    public void errorTone() {
        PlaySound(R.raw.invalid);
    }

    @JavascriptInterface
    public void notificationTone() {
        PlaySound(R.raw.notification_tone);
    }
    
    @JavascriptInterface
    public void rfidTone() { PlaySound(R.raw.rfidtone); }

    @JavascriptInterface
    public  void getTransmissonPower() {
        activity.getReaderPower();
    }
    @JavascriptInterface
    public void setTransmissonPower(int power) {
        activity.setReaderPower(power);
    }


    private void PlaySound(int resource)
    {
        MediaPlayer mp4 = MediaPlayer.create(context, resource);
        mp4.setOnPreparedListener(this::OnPrepared);
        mp4.setOnCompletionListener(this::OnCompletion);
    }

    @JavascriptInterface
    public void ToggleSoftScanTrigger() {
        activity.ToggleSoftScanTrigger();
    }

    @JavascriptInterface
    public boolean InitRFID() {
         return activity.InitRFID();
    }

    @JavascriptInterface
    public boolean isAnyReaderAvailable() {
        return activity.isReaderAvailable();
    }

    @JavascriptInterface
    public void persistToLogs(int level, String msg) {
        // I will implement this at a later date
        if(level > 2) {
            Log.d(TAG, msg);
        }
    }

    @JavascriptInterface
    public void discoverBTDevices () {
        activity.discoverBTDevices();
    }

    @JavascriptInterface
    public void btON () {
        activity.turnONBluetooth();
    }

    @JavascriptInterface
    public void btOFF () {
        activity.turnOFFBluetooth();
    }

    @JavascriptInterface
    public void listBTDevices () {
        activity.listPairedBTDevices();
    }

    @JavascriptInterface
    public void bondWithDevice (String addr) {
        // addr = "A0:E6:F8:8F:4D:B7";
        Log.d(TAG, "Bonding requested for " + addr);
        activity.bondWithDevice (addr);
    }

    @JavascriptInterface
    public void unpairDevice (String addr) {
        Log.d(TAG, "Unpairing requested for " + addr);
        activity.unpairDevice(addr);
    }

    @JavascriptInterface
    public boolean getBTStatus () {
        return activity.isBluetoothON();
    }

    @JavascriptInterface
    public String getDeviceInfo () {
        return activity.getDeviceInfo();
    }

    private void dataToAndroid(String data) {
        Log.d(TAG, "Received data from webview: " + data);
    }

    public void OnPrepared(MediaPlayer mp)
    {
        mp.start();
    }

    public void OnCompletion(MediaPlayer mp)
    {
        mp.release();
    }
}

