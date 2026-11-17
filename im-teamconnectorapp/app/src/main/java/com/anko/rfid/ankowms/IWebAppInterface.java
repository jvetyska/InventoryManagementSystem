package com.anko.rfid.ankowms;


import android.webkit.JavascriptInterface;

public interface IWebAppInterface {
    @JavascriptInterface
    void showToast(String toast);

    @JavascriptInterface
    boolean isRFIDReaderConnected();

    @JavascriptInterface
    void connectRFIDReader();

    @JavascriptInterface
    void disconnectRFIDReader();

    @JavascriptInterface
    void changeRFIDReaderSettings(String jsonSTR);

    @JavascriptInterface
    void searchBarcode(String barcode);

    @JavascriptInterface
    void toggleProxy();

    @JavascriptInterface
    void toggleRFID();

    @JavascriptInterface
    void successTone();

    @JavascriptInterface
    void errorTone();

    @JavascriptInterface
    void notificationTone();

    @JavascriptInterface
    void sendMessage(String type, String config);
}



