package com.anko.rfid.ankowms;

public class KmartDeviceInfo {
    private String storeNumber;
    private String geoState;
    private String appServer;
    private String deviceName;
    private String version;

    public KmartDeviceInfo() {
        storeNumber = "";
        geoState = "";
        appServer = "";
        deviceName = "";
        version = "v" + BuildConfig.VERSION_NAME + "." +BuildConfig.VERSION_CODE;
    }
    public KmartDeviceInfo(String storeNumber, String geoState, String appServer, String deviceName) {
        this.storeNumber = storeNumber;
        this.geoState = geoState;
        this.appServer = appServer;
        this.deviceName = deviceName;
        version = "v" + BuildConfig.VERSION_NAME + "." +BuildConfig.VERSION_CODE;
    }

    public String getStoreNumber() { return storeNumber; }
    public void setStoreNumber(String number) { storeNumber = number;}
    public String getGeoState() { return geoState;}
    public void setGeoState(String state) { geoState = state; }
    public String getAppServer() { return  appServer; }
    public void setAppServer(String server) { appServer = server; }
    public String getDeviceName() { return deviceName; }
    public void setDeviceName(String name) { deviceName = name; }
    public String getVersion() { return version; }
    public void  setVersion(String ver) { version = ver; }
}
